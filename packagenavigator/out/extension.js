"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
let didChangeEvent;
let didSaveEvent;
function activate(context) {
    const localPackageVersions = new Map();
    const locations = new Map();
    let configs = vscode.workspace.getConfiguration("packagenavigator")["packages"];
    const findDeclarationsInternal = async (uri, packageName) => {
        const handleFile = async (newUri, name) => {
            if (name === "package.json") {
                const textDocument = await vscode.workspace.openTextDocument(newUri);
                const json = JSON.parse(textDocument.getText());
                if (json["name"] === packageName) {
                    localPackageVersions.set(packageName, json["version"]);
                }
            }
            else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
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
                    locations.set(packageName + "|||" + decl, new vscode.Location(newUri, new vscode.Range(start, end)));
                }
            }
        };
        const fileType = (await vscode.workspace.fs.stat(uri)).type;
        if (fileType === vscode.FileType.File) {
            await handleFile(uri, uri.path.substring(uri.path.lastIndexOf("/")));
            return;
        }
        else if (fileType !== vscode.FileType.Directory) {
            return;
        }
        const files = await vscode.workspace.fs.readDirectory(uri);
        for (let i = 0; i < files.length; i++) {
            const [name, fileType] = files[i];
            if (fileType === vscode.FileType.File) {
                const newUri = vscode.Uri.joinPath(uri, name);
                await handleFile(newUri, name);
            }
            else if (fileType === vscode.FileType.Directory) {
                await findDeclarationsInternal(vscode.Uri.joinPath(uri, name), packageName);
            }
        }
    };
    const updateDeclarations = (textDocumentToUpdate) => {
        configs.forEach((config) => {
            const repo = config[0];
            const repoPath = config[1];
            const uri = vscode.Uri.file(repoPath);
            if (textDocumentToUpdate) {
                if (textDocumentToUpdate.uri.toString(true).startsWith(uri.toString(true))) {
                    findDeclarationsInternal(textDocumentToUpdate.uri, repo);
                }
            }
            else {
                findDeclarationsInternal(uri, repo);
            }
        });
    };
    updateDeclarations();
    didChangeEvent = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("packagenavigator")) {
            configs = vscode.workspace.getConfiguration("packagenavigator")["packages"];
        }
    });
    didSaveEvent = vscode.workspace.onDidSaveTextDocument((e) => {
        updateDeclarations(e);
    });
    context.subscriptions.push(vscode.languages.registerImplementationProvider({ language: "typescriptreact" }, {
        provideImplementation: async (document, position, token) => {
            const targetedWordRange = document.getWordRangeAtPosition(position);
            const targetedWord = document.getText(targetedWordRange);
            let importFrom = "";
            const importText = document
                .getText()
                .match("import.+" + targetedWord + ".+['\"](.+)['\"]");
            if (!importText || importText.length <= 1) {
                return undefined;
            }
            importFrom = importText[1];
            const config = configs.find((c) => c[0] === importFrom);
            if (!config) {
                return undefined;
            }
            const repoPath = config[1];
            if (!repoPath) {
                return undefined;
            }
            const location = locations.get(importFrom + "|||" + targetedWord);
            if (location) {
                const version = localPackageVersions.get(importFrom);
                if (version) {
                    const folders = vscode.workspace.workspaceFolders;
                    if (folders) {
                        const find = {
                            baseUri: folders[0].uri,
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
                                        const importVersion = json["dependencies"][importFrom];
                                        if (importVersion &&
                                            !importVersion.endsWith(version)) {
                                            vscode.window.showWarningMessage("Imported package version (" +
                                                importVersion +
                                                ") differs from local version (" +
                                                version +
                                                ").");
                                        }
                                    }
                                });
                            }
                        });
                    }
                }
                return location;
            }
        },
    }));
}
exports.activate = activate;
// this method is called when your extension is deactivated
function deactivate() {
    if (didChangeEvent) {
        didChangeEvent.dispose();
    }
    if (didSaveEvent) {
        didSaveEvent.dispose();
    }
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map