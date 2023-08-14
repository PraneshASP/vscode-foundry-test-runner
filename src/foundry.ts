import * as vscode from "vscode";
import {
    TestSuiteInfo,
    TestInfo,
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from "vscode-test-adapter-api";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";

let testSuite: TestSuiteInfo;
let projectRootDir: string;
let outputChannel: vscode.OutputChannel;

function populateTestSuiteInfo(projectDir: string) {
    testSuite = {
        type: "suite",
        id: "root",
        label: "Foundry tests",
        children: [],
    };

    const traverseDirectory = (directoryPath: string) => {
        const excludedContracts = vscode.workspace
            .getConfiguration("foundryTestRunner")
            .excludeTestContracts.toLowerCase();

        const excludedFunctions = vscode.workspace
            .getConfiguration("foundryTestRunner")
            .excludeTestFunctions.toLowerCase();

        const files = fs.readdirSync(directoryPath);
        for (const file of files) {
            const filePath = path.join(directoryPath, file);
            const fileNameArray = filePath.split(".");
            const fileExt =
                "." +
                fileNameArray[fileNameArray.length - 2] +
                "." +
                fileNameArray[fileNameArray.length - 1];

            if (
                fs.statSync(filePath).isDirectory() &&
                !filePath.endsWith("lib") &&
                !filePath.endsWith("node_modules")
            ) {
                traverseDirectory(filePath);
            } else if (fileExt === ".t.sol") {
                const fileContents = fs.readFileSync(filePath, "utf8");
                const lines = fileContents.split("\n");
                const parts = filePath.split("/");
                const fileName = parts[parts.length - 1];
                const contractName = fileName.slice(
                    0,
                    fileName.indexOf(".t.sol"),
                );
                if (excludedContracts.includes(contractName.toLowerCase()))
                    continue;
                let testFunctionNames: TestInfo[] = [];
                let suiteLineNumber;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (
                        line.trim().includes("contract") &&
                        line.trim().includes("Test")
                    )
                        suiteLineNumber = i;
                    if (line.trim().startsWith("function test")) {
                        let functionNameArray = line.split(" ").filter(Boolean);
                        let functionNameCleaned = functionNameArray[1].slice(
                            0,
                            functionNameArray[1].indexOf("("),
                        );

                        if (
                            excludedFunctions.includes(
                                functionNameCleaned.toLowerCase(),
                            )
                        )
                            continue;
                        testFunctionNames.push({
                            type: "test",
                            id: contractName + "::" + functionNameCleaned,
                            label: functionNameCleaned,
                            file: filePath,
                            line: i,
                        });
                    }
                }

                /// Ignore files that doesn't have any tests
                if (testFunctionNames.length > 0) {
                    testSuite.children.push({
                        type: "suite",
                        id: fileName + "::" + contractName,
                        label: contractName,
                        children: testFunctionNames,
                        file: filePath,
                        line: suiteLineNumber,
                    });
                }
            }
        }
    };

    traverseDirectory(projectDir);
}

export function loadFoundryTests(): Promise<TestSuiteInfo> {
    if (projectRootDir === undefined) {
        projectRootDir = getContractRootDir();
    }
    if (projectRootDir == "__null__") {
        return Promise.resolve<TestSuiteInfo>(testSuite);
    }

    populateTestSuiteInfo(projectRootDir);
    return Promise.resolve<TestSuiteInfo>(testSuite);
}

export async function runFoundryTests(
    tests: string[],
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
): Promise<void> {
    for (const suiteOrTestId of tests) {
        const node = findNode(testSuite, suiteOrTestId);
        if (node) {
            await runNode(node, testStatesEmitter);
        }
    }
}

function findNode(
    searchNode: TestSuiteInfo | TestInfo,
    id: string,
): TestSuiteInfo | TestInfo | undefined {
    if (searchNode.id === id) {
        return searchNode;
    } else if (searchNode.type === "suite") {
        for (const child of searchNode.children) {
            const found = findNode(child, id);
            if (found) return found;
        }
    }
    return undefined;
}
function getContractRootDir(): string {
    let activeDoc = vscode.window.activeTextEditor.document;

    let activeFile = activeDoc.fileName;

    let currentDirectory = path.dirname(activeFile);

    while (currentDirectory !== "/") {
        if (fs.existsSync(path.join(currentDirectory, "foundry.toml"))) {
            return currentDirectory;
        }
        currentDirectory = path.dirname(currentDirectory);
    }
    return "__null__";
}

function captureFunctionsAndResults(output: string): { [key: string]: string } {
    const regex = /\[(PASS|FAIL\. Reason: ([^\]]+))\] (\w+)\(\)/g;
    let matches: RegExpExecArray | null;
    const results: { [key: string]: string } = {};

    while ((matches = regex.exec(output)) !== null) {
        results[matches[3]] = matches[1] === "PASS" ? "passed" : "failed";
    }

    return results;
}

async function runNode(
    node: TestSuiteInfo | TestInfo,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
): Promise<void> {
    if (projectRootDir === undefined) {
        projectRootDir = getContractRootDir();
        if (projectRootDir == "__null__") return;
    }
    if (node.type === "suite") {
        testStatesEmitter.fire(<TestSuiteEvent>{
            type: "suite",
            suite: node.id,
            state: "running",
        });

        // Create a new output channel
        if (!outputChannel) {
            outputChannel = vscode.window.createOutputChannel(
                "Foundry test explorer",
                "shellscript",
            );
            outputChannel.show();
        }
        const verbosity =
            vscode.workspace.getConfiguration("foundryTestRunner").verbosity;
        // Execute a command and capture its output
        // prettier-ignore
        const command = `cd ${projectRootDir} && forge test ${verbosity} --mc ${node.label}`;

        const child = cp.exec(command);

        child.stdout.on("data", (data: Buffer) => {
            let output = data.toString().replace(/\x1b\[[0-9;]*m/g, "");
            if (output.includes("PASS") || output.includes("FAIL.")) {
                let testResults = captureFunctionsAndResults(output);

                outputChannel.appendLine(output);
                for (var testResult in testResults) {
                    testStatesEmitter.fire(<TestEvent>{
                        type: "test",
                        test: node.label + "::" + testResult,
                        state: testResults[testResult].toString(),
                    });
                }
            }
        });
        child.stderr.on("data", (data: Buffer) => {
            console.error("Error executing the command:", error.message);
        });
        child.on("exit", (code, signal) => {
            console.log(
                `Child process exited with code ${code} and signal ${signal}`,
            );
        });

        testStatesEmitter.fire(<TestSuiteEvent>{
            type: "suite",
            suite: node.id,
            state: "completed",
        });
    } else {
        node.type === "test";

        // Create a new output channel
        if (!outputChannel) {
            outputChannel = vscode.window.createOutputChannel(
                "Foundry test explorer",
            );
            outputChannel.show();
        }
        const verbosity =
            vscode.workspace.getConfiguration("foundryTestRunner").verbosity;

        // Execute a command and capture its output
        // prettier-ignore
        const command = `cd ${projectRootDir} && forge test ${verbosity} --match-test ${node.label.slice(0,-2)}`;

        testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: node.id,
            state: "running",
        });

        const child = cp.exec(command);
        child.stdout.on("data", (data: Buffer) => {
            let output = data.toString().replace(/\x1b\[[0-9;]*m/g, "");
            outputChannel.appendLine(output);
            if (output.includes("FAIL")) {
                testStatesEmitter.fire(<TestEvent>{
                    type: "test",
                    test: node.id,
                    state: "failed",
                });
            } else {
                testStatesEmitter.fire(<TestEvent>{
                    type: "test",
                    test: node.id,
                    state: "passed",
                });
            }
        });
        child.stderr.on("data", (data: Buffer) => {
            outputChannel.appendLine(
                data.toString().replace(/\x1b\[[0-9;]*m/g, ""),
            );
        });
        child.on("exit", (code, signal) => {
            console.log(
                `Child process exited with code ${code} and signal ${signal}`,
            );
        });
    }
}
