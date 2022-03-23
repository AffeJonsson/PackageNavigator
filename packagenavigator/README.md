# Local Package Navigator

Local Package Navigator allows you to navigate to implementation in external codebases that you have locally.

## Features

Navigate to external code with the "Navigate to local implementations" command, default keybind to Ctrl + Alt + .

![navigate](https://raw.githubusercontent.com/AffeJonsson/PackageNavigator/develop/packagenavigator/packagenavigator.gif)

## Extension Settings

This extension contributes the following settings:

* `packagenavigator.packages`: Configure what packages to look for. Format is array of [packageName, localPath], e.g. [["@types/vscode", "C:/Example/vscodetypes"], ["@types/glob", "C:/Example/globtypes"]].

## Release Notes

### 1.3.0

Add support for ^1.45.0

Show error if configured path doesn't exist on the system

### 1.2.0

Performance increase

### 1.1.0

Change from listening to "Navigate to Implementation" to separate command, localpackagenavigator.navigate

### 1.0.0

Initial release of Local Package Navigator
