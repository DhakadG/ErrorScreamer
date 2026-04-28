# Error & Success Reactor 🔊

<p align="center">
  <img src="https://raw.githubusercontent.com/DhakadG/ErrorScreamer/main/media/banner.webp" alt="Error & Success Reactor Banner" width="100%" />
</p>

> **The ultimate VS Code extension that reacts to your code with sound — screams when things go wrong, celebrates when they go right.**
> Terminal failures, red squiggles, broken saves, failed builds, crashed debuggers — nothing escapes the scream. Successful commands get a victory sound. Fully customizable with per-sound settings, funny toasts, escalation mode, waveform viewer, DND schedule, and more.

[![Version](https://img.shields.io/badge/version-2.3.0-orange?style=flat-square)](https://github.com/DhakadG/ErrorScreamer)
[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)](LICENSE.md)
[![Tests](https://img.shields.io/badge/tests-130%2F130%20passing-brightgreen?style=flat-square)](#)
[![Sound Library](https://img.shields.io/badge/Sounds-52%20Error%20%2B%2015%20Success-purple?style=flat-square)](#-audio-library)
[![VSIX Size](https://img.shields.io/badge/VSIX-5.7%20MB-blue?style=flat-square)](#-packaging)

---

## ✨ Features at a Glance

- ⚡ **5 Trigger Sources** — terminal failures, diagnostic errors, save-with-errors, task failures, debug session crashes
- 🔊 **Instant Playback** — `sound-play` npm for ~50ms latency (no shell spawn)
- 🎵 **Sound Library** — import `.mp3` files, per-sound volume/speed/pitch/reverse
- 🎲 **Random Sound Mode** — separate random toggles for error and success sounds
- 🎉 **Success Sounds** — plays a different sound when commands succeed (exit code 0)
- 😱 **Funny Toasts** — 15 randomized hilarious roast messages on every scream
- 🔥 **Escalation Mode** — sound gets louder and faster as your error streak grows
- 🌙 **Do Not Disturb** — schedule quiet hours (handles overnight windows)
- 📊 **Stats & Counters** — daily error count, current streak, lifetime scream counter
- 🎨 **Settings Webview** — a full GUI panel to manage everything visually
- 📈 **Waveform Viewer** — visualize any sound file with Web Audio API
- 🔇 **Quick Mute** — suppress sounds without losing streak/stat tracking
- 🛡️ **Guards** — cooldown, ignored exit codes, error pattern detection

---

## 💻 Platform Support

| Platform | Audio Engine | Status |
|---|---|---|
| **Windows** | `sound-play` (fast) → PowerShell MediaPlayer (fallback) | ✅ Fully supported |
| **macOS** | `sound-play` (fast) → `afplay` (fallback) | ✅ Fully supported |
| **Linux** | `sound-play` (fast) → `ffplay` / `paplay` / `aplay` (fallback) | ✅ Fully supported |

> Advanced audio processing (speed, pitch, reverse) requires [ffmpeg](https://ffmpeg.org/download.html) on all platforms.

---

## 📦 Installation

### From VSIX

1. Download `error-screamer-2.3.0.vsix`
2. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select the file → reload VS Code
4. Turn your speakers on and write bad code 😈

### From Source

```bash
git clone https://github.com/DhakadG/ErrorScreamer.git
cd error-screamer
npm install
# Press F5 in VS Code to launch Extension Development Host
```

---

## 📖 User Manual

### ⚡ Trigger 1: Terminal Failure *(always on)*

The core trigger. Every time a terminal command exits with a non-zero code, it screams.

**Example:**
1. Open the integrated terminal
2. Run `ls nonexistent` or `exit 1`
3. 🔊 SCREAM!

> Also supports **error pattern detection** — scan terminal output for keywords like `Error:`, `Traceback`, etc. even when exit code is 0. Enable via `errorScreamer.errorPatternDetectionEnabled`.

---

### 🔴 Trigger 2: Diagnostic Errors *(live, while typing)*

Watches your code in real-time. The moment a **new** Error-severity diagnostic (red squiggle) appears, it screams. Uses a 150ms debounce to avoid spam while typing, and resets its baseline when you switch files.

**Example:**
1. Open any `.js`, `.ts`, `.py` file
2. Type something broken like `const = ;`
3. The moment VS Code shows the red squiggle → 🔊 SCREAM!

> Only screams when errors **increase**. Fixing errors does not trigger it.

**To turn off:** Set `errorScreamer.playOnDiagnostics` to `false`.

---

### 💾 Trigger 3: Save & Scream

Every time you press `Ctrl+S`, it checks if the saved file still has Error-severity diagnostics. If it does — scream.

**Example:**
1. Have a file open with red squiggles
2. Press `Ctrl+S`
3. 🔊 Caught!

**To turn off:** Set `errorScreamer.playOnSave` to `false`.

---

### 🛑 Trigger 4: Task Failure

When a VS Code Task (build scripts, test suites, etc.) exits with a non-zero code, it screams.

**How to trigger:**
1. `Ctrl+Shift+B` (Run Build Task) or `Terminal → Run Task`
2. If the task fails → 🔊 SCREAM!

**To turn off:** Set `errorScreamer.playOnTaskFailure` to `false`.

---

### 🐛 Trigger 5: Debug Session Crash

When a debug session terminates (crash, exception, stopped), it screams.

**How to test:**
1. Create `test.py` with `1/0`
2. Press `F5` to debug
3. Python crashes with `ZeroDivisionError` → 🔊 SCREAM!

**To turn off:** Set `errorScreamer.playOnDebuggerCrash` to `false`.

---

### 😱 Funny Toast Messages

When `showErrorToast` and `funnyToasts` are both enabled, each scream shows a random hilarious roast:

| | |
|---|---|
| 😱 AAAHHHHHH! You broke it again! | 💀 RIP your code. Rest in errors. |
| 🚨 ERROR DETECTED. INITIATING SCREAM PROTOCOL. | 🤦 Have you tried turning your brain off and on again? |
| 🔥 Your code just burst into flames! | 🫠 The code is melting... MELTING! |
| 📢 ATTENTION: Your code has committed a crime! | 😂 It's not a bug, it's a ✨ feature ✨ |
| 🧨 KABOOM! Another error explosion! | ☠️ Your code just ragequit. |

...and more! (15 total)

---

### 🔥 Escalation Mode

The more you mess up, the louder and faster it gets.

1. Enable `errorScreamer.escalationEnabled`
2. Set a threshold (default: 3 consecutive errors)
3. Each tier above threshold adds volume boost + speed boost
4. Status bar shows `$(flame) Escalation tier N!`

---

### 🌙 Do Not Disturb

Don't want screams during a late-night meeting?

1. Enable `errorScreamer.doNotDisturbEnabled`
2. Set start/end times (e.g. `23:00` → `08:00`)
3. Sounds are silently suppressed during those hours
4. Handles overnight windows correctly

---

### 🔇 Quick Enable / Disable

1. `Ctrl+Shift+P` → **Error & Success Reactor: Toggle On/Off** — master switch
2. `Ctrl+Shift+P` → **Error & Success Reactor: Quick Mute** — mutes sounds, but streak/stats still track

---

### 🎵 Custom Sounds

1. `Ctrl+Shift+P` → **Error & Success Reactor: Import Sound File** — opens a file picker for `.mp3` and asks which category (Error or Success)
2. Or drop any `.mp3` into `sounds/errors/` or `sounds/success/` — it appears automatically
3. Use **Error & Success Reactor: Select Error Sound** to set the active error sound
4. Each sound has its own **Volume / Speed / Pitch / Reverse / Label** — all configurable in the Settings panel

**Folder structure:**
```
sounds/
  errors/        ← error sounds (.mp3)
    aahh.mp3
    fahhhh.mp3
    ...
  success/       ← success sounds (.mp3)
    mission-passed.mp3
    ...
```

---

## 🎶 Audio Library — 67 Sounds Total

### Error Sounds (52 total)

**v2.3.0 Additions:**
- `ultrakill-explosion` — epic explosion effect
- `ankle-breakage` — bone-crunching sound
- `core-sound-effect` — sci-fi core blast
- `critical-hit-sounds-effect` — gaming critical hit
- `weird-smoosh-effect` — abstract error squelch
- `makabhosda-aag` — Indian comedy meme

**Complete Error Sound Library:**
Includes everything from meme classics (vine-boom, "daddyy chill", "why are you running") to emergency alerts (ambulance siren, undertaker's bell), comedy sounds (crickets chirping, cartoon elements), and new v2.3.0 effects for extra chaos.

### Success Sounds (15 total)

**v2.3.0 Additions:**
- `cartel-song` — iconic cartel victory theme
- `fast-and-furious-tokyo-drift` — drift mode celebration
- `tu-tu-tu-du-max-verstappen` — F1 victory anthem
- `white-tee-rizz` — confidence boost vibes

**Complete Success Sound Library:**
From mission-passed classics to crowd cheers, phonk vibes, and anime celebrations — every code victory deserves recognition.

---

### 📊 Stats & Counters

- **Status bar** (bottom-right) — shows current streak, mute state, escalation tier
- **Daily stats** — error count per day (last 7 days in the Settings panel)
- **Lifetime scream counter** — persistent across sessions, shown in Settings panel stats
- Click the status bar item to view today's stats
- `Ctrl+Shift+P` → **Reset Lifetime Scream Counter** to start fresh

---

## ⚙️ All Settings Reference

Open VS Code Settings (`Ctrl+,`) and search `errorScreamer`:

### General

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch |
| `muted` | boolean | `false` | Quick mute (stats still track) |
| `activeSound` | string | `"aahh"` | Sound ID for errors (from `sounds/errors/`) |
| `successSound` | string | `"mission-passed"` | Sound ID for success (from `sounds/success/`, empty = disabled) |
| `successCooldownSeconds` | number | `5` | Seconds between success sounds |
| `randomErrorSound` | boolean | `false` | Random sound per error |
| `randomSuccessSound` | boolean | `false` | Random sound per success |
| `cooldownSeconds` | number | `3` | Seconds between error sounds |
| `showErrorToast` | boolean | `false` | Show notification after each sound |
| `funnyToasts` | boolean | `true` | Use funny randomized messages in toasts |

### Triggers

| Setting | Type | Default | Description |
|---|---|---|---|
| `playOnDiagnostics` | boolean | `true` | Scream on new diagnostic errors |
| `playOnSave` | boolean | `true` | Scream on save-with-errors |
| `playOnTaskFailure` | boolean | `true` | Scream on task exit ≠ 0 |
| `playOnDebuggerCrash` | boolean | `true` | Scream on debug session end |
| `diagnosticDebounceMs` | number | `150` | Debounce for diagnostics (ms) |

### Detection

| Setting | Type | Default | Description |
|---|---|---|---|
| `errorPatternDetectionEnabled` | boolean | `false` | Scan terminal output for keywords |
| `errorPatterns` | array | `["error:", "Error:", ...]` | Keywords to match |
| `ignoredExitCodes` | array | `[]` | Exit codes to skip |

### Escalation

| Setting | Type | Default | Description |
|---|---|---|---|
| `escalationEnabled` | boolean | `false` | Auto-boost on streak |
| `escalationThreshold` | number | `3` | Streak before escalation starts |
| `escalationVolumeBoost` | number | `0.2` | Volume added per tier |
| `escalationSpeedBoost` | number | `0.3` | Speed added per tier |

### Do Not Disturb

| Setting | Type | Default | Description |
|---|---|---|---|
| `doNotDisturbEnabled` | boolean | `false` | Enable DND schedule |
| `doNotDisturbStart` | string | `"23:00"` | Start time (24h) |
| `doNotDisturbEnd` | string | `"08:00"` | End time (24h) |

### Per-Sound (stored in global state)

Each sound has: **Volume** (0–1), **Speed** (0.5–4×), **Pitch** (0.5–2×), **Reverse**, **Enabled**, **Custom Label**.

---

## 🛠️ All Commands Reference

Press `Ctrl+Shift+P` and type `Error & Success Reactor`:

| Command | What it does |
|---|---|
| **Toggle On/Off** | Master enable/disable |
| **Quick Mute** | Mute sounds (stats still track) |
| **Select Error Sound** | Pick from sound library |
| **Test Current Sound** | Play the current error sound |
| **Adjust Current Sound Settings** | Volume / Speed / Pitch dialog |
| **Toggle Random Error Sound** | Random error sound per error |
| **Toggle Random Success Sound** | Random success sound per success |
| **Toggle Reverse Playback** | Reverse the active sound |
| **Enable/Disable Current Sound** | Toggle sound in library |
| **Edit Label for Current Sound** | Custom display name |
| **Import Sound File** | Import `.mp3` from disk |
| **Open Waveform Viewer** | Visualize waveform |
| **View Today's Error Stats** | Show today's count |
| **Reset Lifetime Scream Counter** | Reset to 0 |
| **Open Settings** | Full settings webview panel |

---

## 🔧 How It Works

Error & Success Reactor hooks into **five** VS Code native APIs simultaneously:

| # | API | Trigger |
|---|---|---|
| 1 | `vscode.window.onDidEndTerminalShellExecution` | Terminal command finishes (exit code + pattern matching) |
| 2 | `vscode.languages.onDidChangeDiagnostics` | Red squiggles increase while typing (150ms debounce + delta check) |
| 3 | `vscode.workspace.onDidSaveTextDocument` | File saved with errors |
| 4 | `vscode.tasks.onDidEndTaskProcess` | VS Code task exits non-zero |
| 5 | `vscode.debug.onDidTerminateDebugSession` | Debug session terminates |

All triggers route through a shared guard chain: **enabled → muted → DND → cooldown → play → toast → escalation → stats**.

**Playback pipeline:**
1. **Fast path** — `sound-play` npm (~50ms, no shell spawn) for normal playback
2. **Slow path** — platform-specific shell commands with ffmpeg for speed/pitch/reverse

---

## 🧪 Testing

```bash
npm test          # 130 unit tests
npm run lint      # ESLint
```

Tests cover: pattern matching, audio filter chains, platform command builders, atempo decomposition, toast pool validation, category-aware sound discovery, and more.

---

## 📦 Packaging

```bash
npm install -g @vscode/vsce
vsce package --out builds/
```

**VSIX Size Breakdown (5.7 MB):**

The extension ships with a comprehensive audio library to ensure out-of-the-box entertainment:

| Component | Size | Purpose |
|---|---|---|
| **Error Sounds (52 files)** | ~4.2 MB | Diverse error reactions: memes, effects, alarms, comedy |
| **Success Sounds (15 files)** | ~1.1 MB | Victory celebrations: anime, music, crowd cheers |
| **Core Code + Dependencies** | ~0.3 MB | `sound-play` npm + extension logic |
| **Metadata & Assets** | ~0.1 MB | Icons, badges, config files |

**Why so many sounds?** No two debugging sessions are alike. Our curated library balances hilarity with audio variety — from trending memes to epic sound effects — so users never get tired of the scream. Each sound is MP3-compressed for delivery efficiency while maintaining quality for immediate playback.

---

## 📜 License

[MIT](LICENSE.md) © Error & Success Reactor Contributors

---

*PRs, issues, and feature requests welcome!*
