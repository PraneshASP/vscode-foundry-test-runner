/**
 * @see https://github.com/microsoft/vscode-extension-samples/blob/main/test-provider-sample/src/testTree.ts
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as process from "process";
import { promisify, TextDecoder } from "util";
import * as vscode from "vscode";

import { outputChannel } from "./main";
import { parseSolidity, parseResult, type TestResults } from "./parser";

const textDecoder = new TextDecoder("utf-8");

export const testData = new WeakMap<vscode.TestItem, FoundryTestData>();

let generationCounter = 0;

function unixToDos(input: string) {
    return input.replace(/(?<!\r)\n/g, "\r\n");
}

export function findClosestFoundryToml(
    directory: string | undefined,
): string | null {
    if (!directory) return null;

    let currentDir = directory;
    const root = path.parse(directory).root;

    while (currentDir !== root) {
        const tomlPath = path.join(currentDir, "foundry.toml");
        if (fs.existsSync(tomlPath)) {
            return currentDir;
        }
        const nextDir = path.dirname(currentDir);
        if (nextDir.length >= currentDir.length) break;
        currentDir = nextDir;
    }
    return null;
}

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
    try {
        const rawContent = await vscode.workspace.fs.readFile(uri);
        return textDecoder.decode(rawContent);
    } catch (e) {
        console.warn(`Error decoding test file for ${uri.fsPath}`, e);
        return "";
    }
};

async function runFoundry(
    testData: FoundryTestData,
    item: vscode.TestItem,
    run: vscode.TestRun,
): Promise<string> {
    const { filename, contractName, testName } = testData;
    const verbosity =
        vscode.workspace.getConfiguration("foundryTestRunner").verbosity;
    const cwd = filename && findClosestFoundryToml(item.uri?.path);

    let command = `forge test ${verbosity}`;
    if (cwd) command = `cd ${cwd} && ${command}`;
    if (filename)
        command += ` --match-path "**/${filename}${
            filename.endsWith(".t.sol") ? "" : "/**"
        }"`;
    if (contractName) command += ` --match-contract ${contractName}`;
    if (testName) command += ` --match-test ${testName}`;

    let ret: { stdout: string; stderr: string };
    let code = 0;
    try {
        ret = await promisify(cp.exec)(command);
    } catch (e) {
        ret = e as { stdout: string; stderr: string };
        code = (e as { code: number }).code;
    }
    const { stdout, stderr } = ret;

    run.appendOutput(`Foundry command: ${command}\r\n`);
    run.appendOutput(`Working directory: ${process.cwd()}\r\n`);
    run.appendOutput(unixToDos(stdout));
    run.appendOutput(unixToDos(stderr));
    if (code !== 0) {
        run.appendOutput(`Foundry exited with code: ${code}\r\n`);
    }

    return stdout;
}

function reportResults(
    data: FoundryTestData,
    run: vscode.TestRun,
    item: vscode.TestItem,
    results: TestResults,
    duration: number,
) {
    if (data instanceof TestCase) {
        const testName = item.label;
        const contractName = item.parent?.label;
        const filename = item.parent?.parent?.label;
        if (filename && contractName) {
            outputChannel.appendLine(
                `looking up results for ${filename}:${contractName}:${testName}, uri: ${item.uri?.toString()}`,
            );
            const result = results[filename]?.[contractName]?.[testName].filter(
                res => item.uri?.toString().endsWith(res.displayedPath),
            )[0];

            if (result) {
                outputChannel.appendLine(`found test result for ${item.id}`);
                if (result.failMessage != null) {
                    const failMessage = new vscode.TestMessage(
                        result.failMessage,
                    );
                    failMessage.location = new vscode.Location(
                        item.uri!,
                        item.range!,
                    );
                    run.failed(item, failMessage, duration);
                } else {
                    run.passed(item, duration);
                }
            } else {
                outputChannel.appendLine(
                    `did not find test result for ${item.id}`,
                );
            }
        }
    } else {
        item.children.forEach(child => {
            const childData = testData.get(child);
            if (childData) {
                reportResults(childData, run, child, results, duration);
            }
        });
    }
}

export class FoundryTestData {
    testName?: string;
    contractName?: string;
    filename?: string;

    async run(item: vscode.TestItem, run: vscode.TestRun): Promise<void> {
        const start = performance.now();
        const stdout = await runFoundry(this, item, run);
        const duration = performance.now() - start;

        const results = parseResult(stdout);
        reportResults(this, run, item, results, duration);
    }
}

export class TestDirectory extends FoundryTestData {
    constructor(public readonly filename: string) {
        super();
        outputChannel.appendLine(`test directory created at ${filename}`);
    }
}

export class TestFile extends FoundryTestData {
    public didResolve = false;

    constructor(public readonly filename: string) {
        super();
        outputChannel.appendLine(`test contact created at ${filename}`);
    }

    public async updateFromDisk(
        controller: vscode.TestController,
        item: vscode.TestItem,
    ) {
        try {
            const content = await getContentFromFilesystem(item.uri!);
            item.error = undefined;
            this.updateFromContents(controller, content, item);
        } catch (e) {
            item.error = (e as Error).stack;
        }
    }

    /**
     * Parses the tests from the input text, and updates the tests contained
     * by this file to be those from the text,
     */
    public updateFromContents(
        controller: vscode.TestController,
        content: string,
        item: vscode.TestItem,
    ) {
        this.didResolve = true;
        const thisGeneration = generationCounter++;
        const filename = item.uri?.path.split("/").pop();
        let parent: vscode.TestItem | undefined;
        let currentContractName: string | undefined;

        parseSolidity(content, {
            onTest: (range, testName) => {
                const data = new TestCase(
                    testName,
                    currentContractName,
                    filename,
                    thisGeneration,
                );
                const id = `${item.uri}/${testName}`;
                const tcase = controller.createTestItem(id, testName, item.uri);
                testData.set(tcase, data);
                tcase.range = range;
                parent?.children.add(tcase);
            },

            onContract: (range, contractName) => {
                const id = `${item.uri}/${contractName}`;

                const tcontract = controller.createTestItem(
                    id,
                    contractName,
                    item.uri,
                );
                parent = tcontract;
                currentContractName = contractName;
                tcontract.range = range;
                testData.set(
                    tcontract,
                    new TestContract(contractName, filename, thisGeneration),
                );
                item.children.add(tcontract);
            },
        });
    }
}

export class TestContract extends FoundryTestData {
    constructor(
        public readonly contractName: string,
        public readonly filename: string | undefined,
        public readonly generation: number,
    ) {
        super();
        outputChannel.appendLine(
            `test contact created at ${filename}:${contractName}`,
        );
    }
}

export class TestCase extends FoundryTestData {
    constructor(
        public readonly testName: string,
        public readonly contractName: string | undefined,
        public readonly filename: string | undefined,
        public readonly generation: number,
    ) {
        super();
        outputChannel.appendLine(
            `test case created at ${filename}:${contractName}:${testName}`,
        );
    }
}
