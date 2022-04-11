import * as vscode from "vscode";
import * as fs from "fs";

let didChangeEvent: vscode.Disposable | undefined;
let didSaveEvent: vscode.Disposable | undefined;

interface Config {
  packageName: string;
  localPath: string;
  excludePath?: string[];
}

export function activate(context: vscode.ExtensionContext) {
  const localPackageVersions: Map<string, string> = new Map();
  const locations: Map<
    string,
    Map<string, vscode.Location | vscode.Location[]>
  > = new Map();
  let configs: Config[] = vscode.workspace.getConfiguration(
    "localPackageNavigator"
  )["packages"];

  const findDeclarationsInternal = async (uri: vscode.Uri, config: Config) => {
    const handleFile = async (newUri: vscode.Uri, name: string) => {
      if (name === "package.json") {
        const textDocument = await vscode.workspace.openTextDocument(newUri);
        const json = JSON.parse(textDocument.getText());
        if (json["name"] === config.packageName) {
          localPackageVersions.set(config.packageName, json["version"]);
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
          let loc = locations.get(config.packageName);
          if (!loc) {
            loc = new Map();
            locations.set(config.packageName, loc);
          }
          const current = loc.get(decl);
          const newLoc = new vscode.Location(
            newUri,
            new vscode.Range(start, end)
          );
          if (!current) {
            loc.set(decl, newLoc);
          } else {
            if (Array.isArray(current)) {
              current.push(newLoc);
            } else {
              const arr = [current, newLoc];
              loc.set(decl, arr);
            }
          }
        }
      }
    };

    if (
      config.excludePath &&
      config.excludePath.some((e) => uri.path.indexOf(config.localPath + e) !== -1)
    ) {
      return;
    }

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
        await findDeclarationsInternal(vscode.Uri.joinPath(uri, name), config);
      }
    }
  };
  const updateDeclarations = (textDocumentToUpdate?: vscode.TextDocument) => {
    configs.forEach((config) => {
      const repoPath = config.localPath;
      const uri = vscode.Uri.file(repoPath);
      locations.get(config.packageName)?.clear();

      if (fs.existsSync(uri.fsPath)) {
        if (textDocumentToUpdate) {
          if (
            textDocumentToUpdate.uri
              .toString(true)
              .startsWith(uri.toString(true))
          ) {
            findDeclarationsInternal(textDocumentToUpdate.uri, config);
          }
        } else {
          findDeclarationsInternal(uri, config);
        }
      }
    });
  };

  updateDeclarations();
  didChangeEvent = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("localPackageNavigator")) {
      configs = vscode.workspace.getConfiguration("localPackageNavigator")[
        "packages"
      ];
      updateDeclarations();
    }
  });
  didSaveEvent = vscode.workspace.onDidSaveTextDocument((e) => {
    updateDeclarations(e);
  });

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "localPackageNavigator.navigate",
      (editor) => {
        const document = editor.document;
        const position = editor.selection.active;
        const targetedWordRange = document.getWordRangeAtPosition(position);
        const targetedWord = document.getText(targetedWordRange);
        vscode.commands
          .executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            "vscode.executeDefinitionProvider",
            document.uri,
            position
          )
          .then((res) => {
            if (!res) {
              return undefined;
            }

            const config = configs.find((c) => {
              return !!res.find((r) => {
                return (
                  (r instanceof vscode.Location
                    ? r.uri.path.indexOf(c.packageName)
                    : r.targetUri.path.indexOf(c.packageName)) > -1
                );
              });
            });
            if (!config) {
              return undefined;
            }
            const pack = config.packageName;
            const packPath = config.localPath;
            const uri = vscode.Uri.file(packPath);

            if (!fs.existsSync(uri.fsPath)) {
              vscode.window
                .showErrorMessage(
                  "Path for package " +
                    pack +
                    " doesn't exist. Configured path is " +
                    packPath,
                  "Configure"
                )
                .then((action) => {
                  if (action === "Configure") {
                    vscode.commands.executeCommand(
                      "workbench.action.openSettings",
                      "localPackageNavigator"
                    );
                  }
                });
              return;
            }

            const locationsInRepo = locations.get(pack);
            if (locationsInRepo) {
              const location = locationsInRepo.get(targetedWord);
              if (location) {
                const version = localPackageVersions.get(pack);
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
                                json["dependencies"][pack];
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
                if (Array.isArray(location)) {
                  vscode.commands.executeCommand(
                    "editor.action.peekLocations",
                    location[0].uri,
                    location[0].range.start,
                    location
                  );
                } else {
                  vscode.window.showTextDocument(location.uri, {
                    selection: location.range,
                  });
                }
              }
            }
          });
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
