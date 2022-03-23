import * as vscode from "vscode";
import * as fs from "fs";

let didChangeEvent: vscode.Disposable | undefined;
let didSaveEvent: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
  const localPackageVersions: Map<string, string> = new Map();
  const locations: Map<string, Map<string, vscode.Location>> = new Map();
  let configs: [string, string][] =
    vscode.workspace.getConfiguration("packagenavigator")["packages"];

  const findDeclarationsInternal = async (
    uri: vscode.Uri,
    packageName: string
  ) => {
    const handleFile = async (newUri: vscode.Uri, name: string) => {
      if (name === "package.json") {
        const textDocument = await vscode.workspace.openTextDocument(newUri);
        const json = JSON.parse(textDocument.getText());
        if (json["name"] === packageName) {
          localPackageVersions.set(packageName, json["version"]);
        }
      } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        const textDocument = await vscode.workspace.openTextDocument(newUri);
        const match = textDocument
          .getText()
          .matchAll(/export\s+\w+\s+(\w+)[:;=\(\s]/g);
        for (let m of match) {
          const decl = m[1];
          const targetIndex = textDocument
            .getText()
            .indexOf(decl, m.index || 0);
          const start = textDocument.positionAt(targetIndex);
          const end = start.with(start.line, start.character + decl.length);
          let loc = locations.get(packageName);
          if (!loc) {
            loc = new Map();
            locations.set(packageName, loc);
          }
          loc.set(
            decl,
            new vscode.Location(newUri, new vscode.Range(start, end))
          );
        }
      }
    };

    const fileType = (await vscode.workspace.fs.stat(uri)).type;
    if (fileType === vscode.FileType.File) {
      await handleFile(uri, uri.path.substring(uri.path.lastIndexOf("/") + 1));
      return;
    } else if (fileType !== vscode.FileType.Directory) {
      return;
    }

    const files = await vscode.workspace.fs.readDirectory(uri);
    for (let i = 0; i < files.length; i++) {
      const [name, fileType] = files[i];
      if (fileType === vscode.FileType.File) {
        const newUri = vscode.Uri.joinPath(uri, name);
        await handleFile(newUri, name);
      } else if (fileType === vscode.FileType.Directory) {
        await findDeclarationsInternal(
          vscode.Uri.joinPath(uri, name),
          packageName
        );
      }
    }
  };
  const updateDeclarations = (textDocumentToUpdate?: vscode.TextDocument) => {
    configs.forEach((config) => {
      const repo = config[0];
      const repoPath = config[1];
      const uri = vscode.Uri.file(repoPath);

      if (fs.existsSync(uri.fsPath)) {
        if (textDocumentToUpdate) {
          if (
            textDocumentToUpdate.uri.toString(true).startsWith(uri.toString(true))
          ) {
            findDeclarationsInternal(textDocumentToUpdate.uri, repo);
          }
        } else {
          findDeclarationsInternal(uri, repo);
        }
      }
    });
  };

  updateDeclarations();
  didChangeEvent = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("packagenavigator")) {
      configs =
        vscode.workspace.getConfiguration("packagenavigator")["packages"];
      updateDeclarations();
    }
  });
  didSaveEvent = vscode.workspace.onDidSaveTextDocument((e) => {
    updateDeclarations(e);
  });

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "packagenavigator.navigate",
      (editor) => {
        
        const document = editor.document;
        const position = editor.selection.active;
        const targetedWordRange = document.getWordRangeAtPosition(position);
        const targetedWord = document.getText(targetedWordRange);
        const importText = document
          .getText()
          .match(
            "import.+" + targetedWord + ".+\\s*from\\s*['\"]\\s*(.+)\\s*['\"]"
          );
        if (!importText || importText.length <= 1) {
          return undefined;
        }
        const importFrom = importText[1];
        const config = configs.find((c) => c[0] === importFrom);
        if (!config) {
          return undefined;
        }
        const repo = config[0];
        const repoPath = config[1];
        const uri = vscode.Uri.file(repoPath);
  
        if (!fs.existsSync(uri.fsPath)){
          vscode.window.showErrorMessage(
            "Path for package " +
              repo +
              " doesn't exist. Configured path is " +
              repoPath,
            "Configure"
          ).then(action => {
            if (action === 'Configure') {
              vscode.commands.executeCommand('workbench.action.openSettings', 'packagenavigator');
            }
          });
          return;
        }

        const locationsInRepo = locations.get(importFrom);
        if (locationsInRepo) {
          const location = locationsInRepo.get(targetedWord);
          if (location) {
            const version = localPackageVersions.get(importFrom);
            if (version) {
              const folders = vscode.workspace.workspaceFolders;
              if (folders) {
                const find: vscode.RelativePattern = {
                  pattern: "package.json",
                  base: folders[0].uri.fsPath,
                };
                vscode.workspace.findFiles(find).then((files) => {
                  if (files.length === 1) {
                    vscode.workspace
                      .openTextDocument(files[0])
                      .then((textDocument) => {
                        const json = JSON.parse(textDocument.getText());
                        if (json["dependencies"]) {
                          const importVersion: string | undefined =
                            json["dependencies"][importFrom];
                          if (
                            importVersion &&
                            !importVersion.endsWith(version)
                          ) {
                            vscode.window.showWarningMessage(
                              "Imported package version (" +
                                importVersion +
                                ") differs from local version (" +
                                version +
                                ")."
                            );
                          }
                        }
                      });
                  }
                });
              }
            }
            vscode.window.showTextDocument(location.uri, {
              selection: location.range,
            });
          }
        }
      }
    )
  );
}

// this method is called when your extension is deactivated
export function deactivate() {
  if (didChangeEvent) {
    didChangeEvent.dispose();
  }
  if (didSaveEvent) {
    didSaveEvent.dispose();
  }
}
