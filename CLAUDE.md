# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm test             # Run 130 unit tests (node ./test/runTest.js)
npm run lint         # ESLint

# Package as VSIX
npm install -g @vscode/vsce
vsce package --out builds/
```

To develop/debug: open the repo in VS Code and press **F5** to launch the Extension Development Host.

## Architecture

This is a single-file VS Code extension. All logic lives in `extension.js` — there is no build step or transpilation.

**Entry points:**
- `activate(context)` — called by VS Code on startup; registers all event listeners and commands
- `deactivate()` — cleanup

**Core flow:**
All five trigger sources (terminal shell execution, diagnostics, save, task process, debug session) funnel through a shared guard chain: `enabled → muted → DND → cooldown → playSound → toast → escalation → stats`.

**Trigger sources** (VS Code APIs):
1. `vscode.window.onDidEndTerminalShellExecution` — terminal exit code + optional pattern matching
2. `vscode.languages.onDidChangeDiagnostics` — new red squiggles (150ms debounce, delta check)
3. `vscode.workspace.onDidSaveTextDocument` — save with existing errors
4. `vscode.tasks.onDidEndTaskProcess` — task exits non-zero
5. `vscode.debug.onDidTerminateDebugSession` — debug session ends

**Playback pipeline:**
- Fast path: `sound-play` npm package (~50ms, no shell spawn) for normal playback
- Slow path: platform shell commands (`ffmpeg`/`afplay`/`ffplay`/`paplay`/`aplay`) for speed, pitch, or reverse effects

**Sound library:**
- `sounds/errors/` — error `.mp3` files
- `sounds/success/` — success `.mp3` files
- Per-sound settings (volume, speed, pitch, reverse, enabled, label) are stored in VS Code `globalState`
- Sound discovery results are cached for 2 seconds (`SOUND_CACHE_TTL_MS`)

**State storage:**
- Settings: VS Code workspace/user configuration under `errorScreamer.*` prefix
- Per-sound settings: `extensionCtx.globalState`
- Lifetime scream counter: `globalState` key `errorScreamer.lifetimeScreamCount`
- Daily stats: `globalState`

**Settings webview:** A full GUI panel (`settingsPanelInstance`) built with inline HTML/JS posted via `postMessage`. Opened via the `errorScreamer.openSettings` command. Uses `script-src 'unsafe-inline'` CSP (not nonce) because the webview relies on inline event handlers in dynamically generated HTML.

**Tests:** `test/unit.test.js` — pure Node.js, no VS Code instance needed. `test/vscode.mock.js` provides VS Code API stubs. Run with `npm test`.

**Configuration prefix:** All settings use `errorScreamer.*` (kept for backward compat after rebrand from "Error Screamer" to "Error & Success Reactor" in v2.1.0).
