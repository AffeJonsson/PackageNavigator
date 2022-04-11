# Local Package Navigator

Local Package Navigator allows you to navigate to implementation in external codebases that you have locally.

## Features

Navigate to external code with the "Navigate to local implementations" command, default keybind to Ctrl + Alt + .

![navigate](https://raw.githubusercontent.com/AffeJonsson/PackageNavigator/develop/packagenavigator/packagenavigator.gif)

## Extension Settings

This extension contributes the following settings:

* `localPackageNavigator.packages`: Configure what packages to look for. Format is array of.
```
{
    packageName: string, 
    localPath: string, 
    excludePath?: string[]
}
```
where packageName is the name of the package, localPath is where on your computer you have the source code, 
and excludePath is an optional array of paths relative to localPath.
e.g. 
```
[
    {
        "packageName": "@types/vscode", 
        "localPath": "C:/Example/vscodetypes", 
        "excludePath": ["/tests"]
    }, 
    {
        "packageName": "@types/glob", 
        "localPath": "C:/Example/globtypes"
    }
]. 
```
## Release Notes

### 1.5.0

Add support for excluding paths in local path

Peek implementation if multiple exports have the same name

### 1.4.0

Add support for navigating to nested exports

### 1.3.0

Add support for vscode ^1.45.0

Show error if configured path doesn't exist on the system

### 1.2.0

Performance increase

### 1.1.0

Change from listening to "Navigate to Implementation" to separate command, localPackageNavigator.navigate

### 1.0.0

Initial release of Local Package Navigator
