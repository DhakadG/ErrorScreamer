"use strict";
// ---------------------------------------------------------------------------
// Minimal VS Code API mock for unit testing
// Only the surfaces touched by extension.js internals are implemented.
// ---------------------------------------------------------------------------

const configOverrides = {
  errorPatterns: ["error:", "Error:", "ERROR:", "fail:", "FAIL:", "Failed", "fatal:", "FATAL:", "Exception", "Traceback", "command not found", "No such file"],
};

const config = {
  get: (key, defaultValue) => {
    if (key in configOverrides) return configOverrides[key];
    return defaultValue;
  },
  update: async () => {},
};

const vscode = {
  workspace: {
    getConfiguration: (_section) => config,
    onDidChangeConfiguration: (_fn) => ({ dispose: () => {} }),
    onDidSaveTextDocument: (_fn) => ({ dispose: () => {} }),
  },
  window: {
    onDidEndTerminalShellExecution: (_fn) => ({ dispose: () => {} }),
    onDidChangeActiveTextEditor: (_fn) => ({ dispose: () => {} }),
    showInformationMessage: (...args) => Promise.resolve(undefined),
    showWarningMessage: (...args) => Promise.resolve(undefined),
    showErrorMessage: (...args) => Promise.resolve(undefined),
    createStatusBarItem: () => ({
      text: "",
      tooltip: "",
      command: "",
      backgroundColor: undefined,
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }),
    createWebviewPanel: () => ({
      webview: {
        html: "",
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: () => {},
      },
      onDidDispose: (_fn) => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    }),
    setStatusBarMessage: (_msg, _timeout) => ({ dispose: () => {} }),
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showOpenDialog: async () => undefined,
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: (_id, _fn) => ({ dispose: () => {} }),
    executeCommand: async () => {},
  },
  languages: {
    onDidChangeDiagnostics: (_fn) => ({ dispose: () => {} }),
    getDiagnostics: (_uri) => [],
  },
  tasks: {
    onDidEndTaskProcess: (_fn) => ({ dispose: () => {} }),
  },
  debug: {
    onDidTerminateDebugSession: (_fn) => ({ dispose: () => {} }),
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  StatusBarAlignment: { Right: 2, Left: 1 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
};

module.exports = vscode;
