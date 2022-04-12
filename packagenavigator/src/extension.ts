import * as vscode from "vscode";
import * as fs from "fs";

let didChangeEvent: vscode.Disposable | undefined;
let didSaveEvent: vscode.Disposable | undefined;

interface Config {
  packageName: string;
  localPath: string;
  excludePaths?: string[];
}

export function activate(context: vscode.ExtensionContext) {
  const locations: Map<
    string,
    Map<string, Map<string, vscode.Location | vscode.Location[]>>
  > = new Map();
  let configs: Config[] = vscode.workspace.getConfiguration(
    "localPackageNavigator"
  )["packages"];
  let fallbackToNavigate: boolean = vscode.workspace.getConfiguration(
    "localPackageNavigator"
  )["fallbackToNavigate"];

  const findLocalPackageVersion = async (uri: vscode.Uri, config: Config) => {
    const files = await vscode.workspace.fs.readDirectory(uri);
    for (let i = 0; i < files.length; i++) {
      const [name, fileType] = files[i];
      if (fileType === vscode.FileType.File && name === "package.json") {
        const newUri = vscode.Uri.joinPath(uri, name);
        const textDocument = await vscode.workspace.openTextDocument(newUri);
        const json = JSON.parse(textDocument.getText());
        if (json["name"] === config.packageName) {
          return json["version"] as string | undefined;
        }
      } else if (fileType === vscode.FileType.Directory) {
        await findLocalPackageVersion(vscode.Uri.joinPath(uri, name), config);
      }
    }
  };

  const findDeclarationsInternal = async (uri: vscode.Uri, config: Config) => {
    const handleFile = async (newUri: vscode.Uri, name: string) => {
      if (
        name.endsWith(".ts") ||
        (name.endsWith(".tsx") && name.indexOf(".") === name.lastIndexOf("."))
      ) {
        vscode.commands
          .executeCommand<(vscode.SymbolInformation & vscode.DocumentSymbol)[]>(
            "vscode.executeDocumentSymbolProvider",
            newUri
          )
          .then((res) => {
            if (res) {
              const func = (
                info: (vscode.SymbolInformation & vscode.DocumentSymbol)[],
                parent?: vscode.SymbolInformation & vscode.DocumentSymbol,
                stack?: string
              ) => {
                info.forEach((r) => {
                  if (
                    r.kind === vscode.SymbolKind.Variable &&
                    parent &&
                    parent.kind === vscode.SymbolKind.Variable
                  ) {
                    return;
                  }
                  if (
                    r.name.indexOf("[") !== -1 ||
                    r.name.indexOf("(") !== -1 ||
                    r.name.indexOf(".") !== -1
                  ) {
                    return;
                  }
                  let loc = locations.get(config.packageName);
                  if (!loc) {
                    loc = new Map();
                    locations.set(config.packageName, loc);
                  }
                  const fileNameWithoutExtension = name.substring(
                    0,
                    name.indexOf(".")
                  );
                  let current = loc.get(fileNameWithoutExtension);
                  const rLocation = new vscode.Location(
                    r.location.uri,
                    r.selectionRange
                  );
                  const stackAndName = (stack ? stack + "/" : "") + r.name;
                  if (!current) {
                    current = new Map();
                    loc.set(fileNameWithoutExtension, current);
                    current.set(stackAndName, rLocation);
                  } else {
                    const locations = current.get(stackAndName);
                    if (Array.isArray(locations)) {
                      locations.push(rLocation);
                    } else if (locations) {
                      const arr = [locations, rLocation];
                      current.set(stackAndName, arr);
                    } else {
                      current.set(stackAndName, rLocation);
                    }
                  }
                  func(
                    r.children as (vscode.SymbolInformation &
                      vscode.DocumentSymbol)[],
                    r,
                    stackAndName
                  );
                });
              };
              func(res);
            }
          });
      }
    };

    const localPath = vscode.Uri.parse(config.localPath);
    if (
      config.excludePaths &&
      config.excludePaths.some(
        (e) => uri.path.indexOf(vscode.Uri.joinPath(localPath, e).path) !== -1
      )
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

      if (fs.existsSync(uri.fsPath)) {
        if (textDocumentToUpdate) {
          if (
            textDocumentToUpdate.uri
              .toString(true)
              .startsWith(uri.toString(true))
          ) {
            locations.get(config.packageName)?.clear();
            findDeclarationsInternal(textDocumentToUpdate.uri, config);
          }
        } else {
          locations.get(config.packageName)?.clear();
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
      fallbackToNavigate = vscode.workspace.getConfiguration(
        "localPackageNavigator"
      )["fallbackToNavigate"];
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
        vscode.commands
          .executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            "vscode.executeImplementationProvider",
            document.uri,
            position
          )
          .then((res) => {
            if (!res) {
              return undefined;
            }

            let targetFileName: string | undefined;
            let targetUri: vscode.Uri | undefined;
            let targetRange: vscode.Range | undefined;
            const config = configs.find((c) => {
              return !!res.find((r) => {
                if (r instanceof vscode.Location) {
                  targetUri = r.uri;
                  targetRange = r.range;
                  targetFileName = r.uri.path.substring(
                    r.uri.path.lastIndexOf("/") + 1
                  );
                  console.log(targetFileName);
                  targetFileName = targetFileName.substring(
                    0,
                    targetFileName.indexOf(".")
                  );
                  return r.uri.path.indexOf(c.packageName) > -1;
                }
                targetUri = r.targetUri;
                targetRange = r.targetRange;
                targetFileName = r.targetUri.path.substring(
                  r.targetUri.path.lastIndexOf("/") + 1
                );
                console.log(targetFileName);
                targetFileName = targetFileName.substring(
                  0,
                  targetFileName.indexOf(".")
                );
                return r.targetUri.path.indexOf(c.packageName) > -1;
              });
            });
            if (!config || !targetFileName || !targetUri || !targetRange) {
              if (fallbackToNavigate) {
                vscode.commands
                  .executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                    "vscode.executeImplementationProvider",
                    document.uri,
                    position
                  )
                  .then((res) => {
                    if (res) {
                      const locations = res.filter(
                        (r) => r instanceof vscode.Location
                      ) as vscode.Location[];
                      if (locations.length > 0) {
                        vscode.commands.executeCommand(
                          "editor.action.goToLocations",
                          locations[0].uri,
                          locations[0].range.start,
                          locations
                        );
                      }
                    }
                  });
              }
              return undefined;
            }

            vscode.commands
              .executeCommand<
                (vscode.SymbolInformation & vscode.DocumentSymbol)[]
              >("vscode.executeDocumentSymbolProvider", targetUri)
              .then((res) => {
                if (!res) {
                  return;
                }
                const func = (
                  symbols: (vscode.SymbolInformation & vscode.DocumentSymbol)[],
                  parent: string
                ): string | undefined => {
                  for (const symbol of symbols) {
                    if (symbol.selectionRange.isEqual(targetRange!)) {
                      return (parent ? parent + "/" : "") + symbol.name;
                    }
                    const res = func(
                      symbol.children as (vscode.SymbolInformation &
                        vscode.DocumentSymbol)[],
                      (parent ? parent + "/" : "") + symbol.name
                    );
                    if (res) {
                      return res;
                    }
                  }
                };

                const match = func(res, "");
                if (!match) {
                  return;
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
                  const location = locationsInRepo.get(targetFileName!);
                  if (location) {
                    findLocalPackageVersion(uri, config).then((version) => {
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
                                  const json = JSON.parse(
                                    textDocument.getText()
                                  );
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
                    });
                    const inFile = location.get(match);
                    if (Array.isArray(inFile)) {
                      vscode.commands.executeCommand(
                        "editor.action.peekLocations",
                        inFile[0].uri,
                        inFile[0].range.start,
                        inFile
                      );
                    } else if (inFile) {
                      vscode.window.showTextDocument(inFile.uri, {
                        selection: inFile.range,
                      });
                    }
                  }
                }
              });
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
