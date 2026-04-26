# Changelog

All notable changes to **Error & Success Reactor** (formerly Error Screamer) are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [2.3.0] — 2026-04-26

### Fixed
- **Per-sound audio settings not applying reliably from the settings panel** — Range slider drags (volume, speed, pitch) would intermittently revert or appear not to take effect. Root cause: every `input` event on a slider triggered a full state refresh that destroyed and recreated the entire settings panel DOM while the slider was still being dragged, causing the drag target element to disappear mid-gesture. Fixed by suppressing the re-render during slider drag (`noRefresh` flag) and letting the single correct re-render happen on `mouseup` via the `change` event.
- **Sound label and enabled-state changes taking up to 2 seconds to appear in the UI** — `saveSettingsForSound()` did not invalidate the 2-second sound discovery cache after writing to `globalState`, so the sound list served stale `label`/`enabled` values for the full TTL window. Fixed by calling `invalidateSoundCache()` immediately after each save.

### Added
- 6 new error sounds: `error - ultrakill-explosion`, `error - ankle-breakage`, `error - core-sound-effect`, `error - critical-hit-sounds-effect`, `error - weird smoosh effect`, `makabhosda_aag`
- 4 new success sounds: `success - cartel-song`, `success - fast and furious tokyo drift`, `success - tu-tu-tu-du-max-verstappen`, `success - white-tee-rizz`

---

## [2.2.3] — 2026-03-11

### Changed
- Updated extension icon

---

## [2.2.2] — 2026-03-11

### Changed
- Updated extension icon

---

## [2.2.1] — 2026-03-11

### Changed
- Improved Marketplace extension description for clarity and discoverability

---

## [2.2.0] — 2026-03-11

### Fixed
- **Settings panel not rendering/interactive** — rewrote the entire settings webview from scratch using proper VS Code patterns: nonce-based CSP with event delegation (`data-*` attributes + `addEventListener`). Inline event handlers (`onclick`, `onchange`, `oninput`) are blocked by VS Code's nonce-based CSP; the old code used them extensively, causing the page to show "Loading..." forever. Added phased initialization with error boundaries so any future failures are visible
- **Toast messages cut off** — removed the verbose "Error & Success Reactor [exit N]:" prefix from toast notifications; now shows just the message content (VS Code already displays the extension source separately)

### Added
- **Success Cooldown** control in the settings panel (was a JSON-only setting before)
- 30 new unit tests covering settings panel HTML generation, CSP correctness, state serialization, toast behavior, per-sound settings persistence, and round-trip integrity (130 total, up from 100)

---

## [2.1.2] — 2026-03-11

### Changed
- Internal code improvements and dependency updates

---

## [2.1.1] — 2026-03-11

### Added
- Extension icon and README banner image

---

## [2.1.0] — 2026-02-28

### Added
- **Sound category folders** — `sounds/errors/` and `sounds/success/` subfolders replace the flat layout
- **Category-aware discovery** — `discoverSoundsByCategory()`, `discoverErrorSounds()`, `discoverSuccessSounds()` with per-category caching
- **Separate random toggles** — `randomErrorSound` and `randomSuccessSound` replace the old `randomSoundMode`
- **Import category picker** — importing sounds now asks whether to file under Error or Success
- **Migration logic** — flat `.mp3` files auto-move to `sounds/errors/` on activation; `randomSoundMode` setting migrates to `randomErrorSound`
- Keywords: `success`, `reactor`, `celebration` added to package.json

### Changed
- **Rebranded** from "Error Screamer" to **Error & Success Reactor** — all 53 user-facing strings, command titles, webview panels, and documentation updated
- `displayName` → "Error & Success Reactor" (internal `errorScreamer.*` config prefix kept for backward compatibility)
- `description` updated to reflect dual error + success scope
- README title, tagline, badges, and all references updated
- Version bumped to 2.1.0

### Fixed
- `YOUR_USERNAME` placeholder in repository URL and README replaced with `lost-husky`

---

## [2.0.0] — 2026-02-28

### Added
- **4 new triggers** — diagnostic errors (with 150ms debounce + delta check), save-with-errors, task failure, debug session crash
- **Per-trigger toggles** — `playOnDiagnostics`, `playOnSave`, `playOnTaskFailure`, `playOnDebuggerCrash` settings
- **Funny toasts** — 15 randomized hilarious roast messages (`funnyToasts` setting, on by default)
- **Lifetime scream counter** — persistent across sessions, shown in the Settings panel stats section
- **Reset Lifetime Scream Counter** command
- **Triggers section** in the settings webview panel — toggle switches for all 4 new triggers + debounce slider
- `diagnosticDebounceMs` setting (50–2000ms, default 150)
- Diagnostic baseline resets on active editor change (fixes false positives when switching files)

### Changed
- Version bumped to 2.0.0
- VSIX size reduced from 3.56 MB / 1,429 files → **330 KB / 14 files** (excluded devDependencies from bundle)
- Error toast now uses `showWarningMessage` (more visible, doesn't stack in OS notifications)
- README completely rewritten — user manual style with trigger-by-trigger guide, badges, platform table, "How It Works" section
- package.json: added keywords, author, MIT license, updated description

### Fixed
- `.vscodeignore` now properly excludes `node_modules/**` except `sound-play`

---

## [1.1.0] — 2026-02-28

### Added
- `sound-play` npm integration for instant playback (~50ms vs ~700ms)
- Success sound with separate cooldown (`successSound`, `successCooldownSeconds`)
- Sound discovery cache with 2s TTL
- Terminal output capped at 100 KB for pattern matching
- 49 unit tests

### Changed
- Playback uses fast path (sound-play) by default, falls back to exec-based for advanced features
- README updated to document all features

---

## [1.0.1] — 2026-02-28

### Fixed
- Bug fixes from initial code review
- 38 unit tests added

---

## [1.0.0] — 2026-02-28

### Added
- Initial release — complete rewrite of the original `aaahhhhhh-sound-error` extension
- Error sound on terminal failure (exit code ≠ 0)
- Per-sound settings (volume, speed, pitch, reverse)
- Random sound mode
- Escalation mode
- Do Not Disturb schedule
- Error pattern detection
- Settings webview panel
- Waveform viewer
- Sound import, custom labels
- Daily error stats
- 13 commands
