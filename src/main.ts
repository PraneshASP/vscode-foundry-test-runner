import * as vscode from "vscode";
import { TestHub, testExplorerExtensionId } from "vscode-test-adapter-api";
import { Log, TestAdapterRegistrar } from "vscode-test-adapter-util";
import { FoundryTestAdapter } from "./adapter";

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

  const log = new Log(
    "foundryTestExplorer",
    workspaceFolder,
    "Foundry Tests Explorer Log"
  );
  context.subscriptions.push(log);

  // get the Test Explorer extension
  const testExplorerExtension = vscode.extensions.getExtension<TestHub>(
    testExplorerExtensionId
  );
  if (log.enabled)
    log.info(
      `Foundry Tests Explorer ${testExplorerExtension ? "" : "not "}found`
    );

  if (testExplorerExtension) {
    const testHub = testExplorerExtension.exports;

    context.subscriptions.push(
      new TestAdapterRegistrar(
        testHub,
        (workspaceFolder) => new FoundryTestAdapter(workspaceFolder, log),
        log
      )
    );
  }
}
