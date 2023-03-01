import * as vscode from "vscode";
import { TestHub, testExplorerExtensionId } from "vscode-test-adapter-api";
import { Log, TestAdapterRegistrar } from "vscode-test-adapter-util";
import { ExampleAdapter } from "./adapter";

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

    // this will register an ExampleTestAdapter for each WorkspaceFolder
    context.subscriptions.push(
      new TestAdapterRegistrar(
        testHub,
        (workspaceFolder) => new ExampleAdapter(workspaceFolder, log),
        log
      )
    );
    // Register CodeLens provider for foundry test files
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        { scheme: "file", pattern: "**/*.t.sol" },
        {
          provideCodeLenses(document) {
            const lenses = [];

            // Find all function test_ declarations and add CodeLens
            const regex = /function test_/gm;
            let match = regex.exec(document.getText());
            while (match != null) {
              const startPosition = document.positionAt(match.index);
              const endPosition = document.positionAt(
                match.index + match[0].length
              );
              const range = new vscode.Range(startPosition, endPosition);
              const codeLens = new vscode.CodeLens(range);
              lenses.push(codeLens);
              match = regex.exec(document.getText());
            }

            return lenses;
          },
        }
      )
    );
  }
}
