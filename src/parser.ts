import * as vscode from "vscode";

import { outputChannel } from "./main";

const resultRe = /\[(PASS|FAIL\. Reason: (.+))\] ([^(]+)\(/;
const sectionRe = /Running \d+ tests? for (.+):(\S+)/;

function removeANSIColorCodes(str: string) {
    return str.replace(/\x1b\[\d+m/g, "");
}

export function parseSolidity(
    text: string,
    events: {
        onTest(range: vscode.Range, testName: string): void;
        onContract(range: vscode.Range, contractName: string): void;
    },
) {
    const excludedContracts = vscode.workspace
        .getConfiguration("foundryTestRunner")
        .excludeTestContracts.toLowerCase();
    const excludedFunctions = vscode.workspace
        .getConfiguration("foundryTestRunner")
        .excludeTestFunctions.toLowerCase();
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const tokens = line.split(" ").filter(Boolean);
        if (tokens[0] === "contract") {
            const contractName = tokens[1];
            if (!excludedContracts.includes(contractName.toLowerCase())) {
                const contractNamePos = line.indexOf(contractName);
                const range = new vscode.Range(
                    new vscode.Position(i, contractNamePos),
                    new vscode.Position(
                        i,
                        contractNamePos + contractName.length,
                    ),
                );
                events.onContract(range, contractName);
            }
        }
        if (tokens[0] === "function" && tokens[1].startsWith("test")) {
            const testName = tokens[1];
            if (!excludedFunctions.includes(testName.toLowerCase())) {
                const testNamePos = line.indexOf(testName);
                const range = new vscode.Range(
                    new vscode.Position(i, testNamePos),
                    new vscode.Position(i, testNamePos + testName.length),
                );
                const strippedTestName = testName.split("(")[0] ?? testName;
                events.onTest(range, strippedTestName);
            }
        }
    }
}

export interface TestResults {
    [filename: string]: {
        [contractName: string]: {
            [testName: string]: [
                {
                    failMessage?: string;
                    /**
                     * relative path shown by Foundry
                     * but we don't know what the base path is
                     */
                    displayedPath: string;
                },
            ];
        };
    };
}

export function parseResult(colorStdout: string): TestResults {
    const stdout = removeANSIColorCodes(colorStdout);
    const results: TestResults = {};
    let currentFilename;
    let currentDisplayFilename;
    let currentContractName;
    for (const line of stdout.split("\n")) {
        outputChannel.appendLine(`parsing results: ${line}`);
        if (line === "Failing tests:") break;

        const sectionMatch = sectionRe.exec(line);
        if (sectionMatch) {
            outputChannel.appendLine(
                `parsing results: found section ${sectionMatch[0]}`,
            );
            currentDisplayFilename = sectionMatch[1];
            const currentPathSegments = sectionMatch[1].split("/");
            currentFilename =
                currentPathSegments[currentPathSegments.length - 1];
            currentContractName = sectionMatch[2];
        }

        if (currentDisplayFilename && currentFilename && currentContractName) {
            const match = resultRe.exec(line);
            if (!match) continue;
            const failMessage = match[1] === "PASS" ? undefined : match[2];
            results[currentFilename] = results[currentFilename] ?? {};
            results[currentFilename][currentContractName] =
                results[currentFilename][currentContractName] ?? {};
            results[currentFilename][currentContractName][match[3]] =
                results[currentFilename][currentContractName][match[3]] ?? [];
            results[currentFilename][currentContractName][match[3]].push({
                failMessage,
                displayedPath: currentDisplayFilename,
            });
            outputChannel.appendLine(
                `parsing results found results ${currentFilename}:${currentContractName}:${match[3]}`,
            );
        }
    }
    return results;
}
