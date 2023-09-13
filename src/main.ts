/**
 * @see - https://github.com/microsoft/vscode-extension-samples/blob/main/test-provider-sample/src/extension.ts
 */

import * as vscode from "vscode";
import {
    findClosestFoundryToml,
    testData,
    TestDirectory,
    TestFile,
    FoundryTestData,
} from "./testTree";

export const outputChannel = vscode.window.createOutputChannel(
    "Foundry Test Runner",
);

function getPathSegments(uri: vscode.Uri): string[] {
    return uri.path.split("/").filter(Boolean);
}

let projectRootSegmentCount = 0;

export async function activate(context: vscode.ExtensionContext) {
    const ctrl = vscode.tests.createTestController(
        "foundryTestController",
        "Foundry Tests",
    );
    context.subscriptions.push(ctrl);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const projectRoot =
        workspaceFolder && findClosestFoundryToml(workspaceFolder.path);
    outputChannel.appendLine(`Project root: ${projectRoot}`);
    if (projectRoot) {
        projectRootSegmentCount = getPathSegments(
            vscode.Uri.file(projectRoot),
        ).length;
    }

    const fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
    const runHandler = (
        request: vscode.TestRunRequest,
        cancellation: vscode.CancellationToken,
    ) => {
        if (!request.continuous) {
            return startTestRun(request);
        }

        const l = fileChangedEmitter.event(uri =>
            startTestRun(
                new vscode.TestRunRequest(
                    [getOrCreateFile(ctrl, uri).file],
                    undefined, // exclude list
                    request.profile,
                    true, // this is a continuously-refreshing test
                ),
            ),
        );
        cancellation.onCancellationRequested(() => l.dispose());
    };

    const startTestRun = (request: vscode.TestRunRequest) => {
        const queue: { test: vscode.TestItem; data: FoundryTestData }[] = [];
        const run = ctrl.createTestRun(request);

        const promises: Promise<void>[] = [];
        /**
         * Recursively adds items to the tests UI sidebar,
         * but only actually runs the top-level test requested (hence `shouldQueue`).
         * This test result will include all the childrens results,
         * so we don't have to run the children tests individually.
         */
        const discoverTests = (
            tests: Iterable<vscode.TestItem>,
            shouldQueue: boolean,
        ) => {
            for (const test of tests) {
                if (request.exclude?.includes(test)) {
                    outputChannel.appendLine(`${test.id} excluded by request`);
                    continue;
                }

                const data = testData.get(test);
                if (data instanceof TestFile && !data.didResolve) {
                    outputChannel.appendLine(
                        `Resolving test file for ${test.id}`,
                    );
                    promises.push(data.updateFromDisk(ctrl, test));
                } else if (data instanceof TestDirectory) {
                    outputChannel.appendLine(
                        `Resolving test tree for ${test.id}`,
                    );
                    discoverTests(gatherTestItems(test.children), false);
                }
                if (data && shouldQueue) {
                    run.enqueued(test);
                    queue.push({ test, data });
                }
            }
            return;
        };

        const runTestQueue = async () => {
            for (const { test, data } of queue) {
                run.appendOutput(`Running ${test.id}\r\n`);
                if (run.token.isCancellationRequested) {
                    run.skipped(test);
                } else {
                    run.started(test);
                    await data.run(test, run);
                }

                run.appendOutput(`Completed ${test.id}\r\n`);
            }
            run.end();
        };

        discoverTests(request.include ?? gatherTestItems(ctrl.items), true);
        Promise.all(promises).then(runTestQueue);
    };

    ctrl.refreshHandler = async () => {
        outputChannel.appendLine("Refreshing tests");
        await Promise.all(
            getWorkspaceTestPatterns().map(({ pattern }) =>
                findInitialFiles(ctrl, pattern),
            ),
        );
    };

    ctrl.createRunProfile(
        "Run Tests",
        vscode.TestRunProfileKind.Run,
        runHandler,
        true,
        undefined,
        true,
    );

    ctrl.resolveHandler = async item => {
        outputChannel.appendLine(`Resolving ${item?.id}`);
        if (!item) {
            context.subscriptions.push(
                ...startWatchingWorkspace(ctrl, fileChangedEmitter),
            );
            return;
        }

        const data = testData.get(item);
        if (data instanceof TestFile) {
            await data.updateFromDisk(ctrl, item);
        }
    };

    function updateNodeForDocument(e: vscode.TextDocument) {
        if (e.uri.scheme !== "file") {
            return;
        }

        if (!e.uri.path.endsWith(".t.sol")) {
            return;
        }

        const { file, data } = getOrCreateFile(ctrl, e.uri);
        data.updateFromContents(ctrl, e.getText(), file);
    }

    for (const document of vscode.workspace.textDocuments) {
        vscode.workspace.workspaceFolders;
        updateNodeForDocument(document);
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(updateNodeForDocument),
        vscode.workspace.onDidChangeTextDocument(e =>
            updateNodeForDocument(e.document),
        ),
    );
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
    const existing = controller.items.get(uri.toString());
    if (existing) {
        return { file: existing, data: testData.get(existing) as TestFile };
    }

    const segments = getPathSegments(uri);
    outputChannel.appendLine(
        `Adding ${uri} (${segments.length} segments, ${projectRootSegmentCount} root segments)`,
    );
    let currentParent: vscode.TestItem | undefined;

    for (let i = projectRootSegmentCount; i < segments.length; i++) {
        const collection = currentParent?.children || controller.items;
        const isFile = i === segments.length - 1;
        const segmentUri = uri.with({
            path: segments.slice(0, i + 1).join("/"),
        });
        const segmentId = segmentUri.toString();

        let item = collection.get(segmentId);
        if (!item) {
            const label = segments[i];
            outputChannel.appendLine(
                `Creating ${segmentId} with label ${label}`,
            );
            item = controller.createTestItem(segmentId, label, segmentUri);
            collection.add(item);

            if (isFile) {
                const data = new TestFile(label);
                testData.set(item, data);
                item.canResolveChildren = true;
            } else {
                const data = new TestDirectory(label);
                testData.set(item, data);
                item.canResolveChildren = false;
            }
        }

        if (isFile) {
            return { file: item, data: testData.get(item) as TestFile };
        }

        currentParent = item;
    }

    throw new Error(`${uri} has no path segments`);
}

function gatherTestItems(collection: vscode.TestItemCollection) {
    const items: vscode.TestItem[] = [];
    collection.forEach(item => items.push(item));
    return items;
}

function getWorkspaceTestPatterns() {
    if (!vscode.workspace.workspaceFolders) {
        return [];
    }

    return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
        workspaceFolder,
        pattern: new vscode.RelativePattern(workspaceFolder, "**/*.t.sol"),
    }));
}

async function findInitialFiles(
    controller: vscode.TestController,
    pattern: vscode.GlobPattern,
    exclude: vscode.GlobPattern = "**/node_modules/**",
) {
    for (const file of await vscode.workspace.findFiles(pattern, exclude)) {
        getOrCreateFile(controller, file);
    }
}

function startWatchingWorkspace(
    controller: vscode.TestController,
    fileChangedEmitter: vscode.EventEmitter<vscode.Uri>,
) {
    return getWorkspaceTestPatterns().map(({ pattern }) => {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate(uri => {
            getOrCreateFile(controller, uri);
            fileChangedEmitter.fire(uri);
        });
        watcher.onDidChange(async uri => {
            const { file, data } = getOrCreateFile(controller, uri);
            if (data.didResolve) {
                await data.updateFromDisk(controller, file);
            }
            fileChangedEmitter.fire(uri);
        });
        watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

        findInitialFiles(controller, pattern);

        return watcher;
    });
}
