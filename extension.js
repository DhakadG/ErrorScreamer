// Error & Success Reactor — VS Code Extension
// Repository: https://github.com/DhakadG/ErrorScreamer

const vscode = require("vscode");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");

// Fast cross-platform audio playback (no shell spawn for the common case)
let soundPlay;
try {
  soundPlay = require("sound-play");
} catch (_) {
  // Fallback: sound-play not installed — will use exec-based playback
  soundPlay = null;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {vscode.ExtensionContext} */
let extensionCtx;

/** Whether the extension is fully enabled (master switch). */
let isExtensionEnabled = true;

/** Whether sounds are muted (extension still tracks stats/streak). */
let isMuted = false;

/** Unix timestamp (ms) of the last time an error sound was triggered. */
let lastErrorSoundPlayedAt = 0;

/** Unix timestamp (ms) of the last time a success sound was triggered. */
let lastSuccessSoundPlayedAt = 0;

/** Number of consecutive terminal failures since the last success. */
let currentErrorStreak = 0;

/** VS Code status bar item showing streak count or mute state. */
let statusBarItem;

/** Settings webview panel instance — null when the panel is closed. */
let settingsPanelInstance = null;

/** Per-category sound discovery caches. Invalidated after SOUND_CACHE_TTL_MS. */
const soundCache = { errors: null, success: null, errorsTs: 0, successTs: 0 };
const SOUND_CACHE_TTL_MS = 2000;

/** Max bytes to read from terminal output for pattern matching. */
const MAX_TERMINAL_OUTPUT_BYTES = 102400; // 100 KB

// --- New trigger state (v2.0) ---

/** Diagnostic debounce timer handle — cleared/reset each time diagnostics change. */
let diagnosticDebounceTimeout = null;

/** Previous diagnostic error count, tracked per-URI to detect increases. */
let previousDiagnosticErrorCount = 0;

/** URI string of the last active editor — used to reset diagnostic baseline. */
let lastActiveEditorUri = "";

/** Lifetime scream counter globalState key. */
const LIFETIME_SCREAM_KEY = "errorScreamer.lifetimeScreamCount";

/** Pool of funny toast messages. */
const FUNNY_TOASTS = [
  "😱 AAAHHHHHH! You broke it again!",
  "💀 RIP your code. Rest in errors.",
  "😱 SCREAMING INTERNALLY... and externally!",
  "🔥 Your code just burst into flames!",
  "🚨 ERROR DETECTED. INITIATING SCREAM PROTOCOL.",
  "bruh... 💀",
  "😤 Another one bites the dust!",
  "🤦 Have you tried turning your brain off and on again?",
  "📢 ATTENTION: Your code has committed a crime!",
  "😂 It's not a bug, it's a ✨ feature ✨",
  "🫠 The code is melting... MELTING!",
  "🎪 Welcome to the error circus!",
  "💩 Well that stinks.",
  "🧨 KABOOM! Another error explosion!",
  "☠️ Your code just ragequit.",
];

// ---------------------------------------------------------------------------
// Required VS Code entry points
// ---------------------------------------------------------------------------

/**
 * Called by VS Code when the extension activates.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  try {
    console.log("Error & Success Reactor: activating");
    extensionCtx = context;
    initializeExtension(context);
    console.log("Error & Success Reactor: activation complete");
  } catch (err) {
    console.error("Error & Success Reactor: activation failed", err);
    vscode.window.showErrorMessage("Error & Success Reactor failed to activate: " + err.message);
  }
}

/** Called by VS Code when the extension deactivates. */
function deactivate() {
  console.log("Error & Success Reactor: deactivated");
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Migration: if any .mp3 files exist directly in sounds/ (flat layout from v2.0),
 * move them into sounds/errors/ for the new category-based layout.
 * @param {vscode.ExtensionContext} context
 */
function migrateFlatSoundsToCategories(context) {
  try {
    const soundsRoot = path.join(context.extensionPath, "sounds");
    if (!fs.existsSync(soundsRoot)) return;

    const flatMp3s = fs.readdirSync(soundsRoot).filter((f) => f.toLowerCase().endsWith(".mp3") && fs.statSync(path.join(soundsRoot, f)).isFile());
    if (flatMp3s.length === 0) return;

    const errDir = path.join(soundsRoot, "errors");
    if (!fs.existsSync(errDir)) fs.mkdirSync(errDir, { recursive: true });

    for (const file of flatMp3s) {
      const src = path.join(soundsRoot, file);
      const dst = path.join(errDir, file);
      if (!fs.existsSync(dst)) {
        fs.renameSync(src, dst);
        console.log(`Reactor migration: moved ${file} → sounds/errors/`);
      } else {
        // Target already exists — remove the flat copy
        fs.unlinkSync(src);
      }
    }

    // Ensure sounds/success/ exists
    const sucDir = path.join(soundsRoot, "success");
    if (!fs.existsSync(sucDir)) fs.mkdirSync(sucDir, { recursive: true });
  } catch (err) {
    console.error("Reactor: migration (flat→categories) failed:", err);
  }
}

/**
 * Migration: if user has `randomSoundMode` set, copy its value to `randomErrorSound`
 * and remove the old key.
 */
function migrateRandomSoundModeSetting() {
  try {
    const cfg = vscode.workspace.getConfiguration("errorScreamer");
    const inspect = cfg.inspect("randomSoundMode");
    if (inspect && inspect.globalValue !== undefined) {
      cfg.update("randomErrorSound", inspect.globalValue, vscode.ConfigurationTarget.Global);
      cfg.update("randomSoundMode", undefined, vscode.ConfigurationTarget.Global);
      console.log("Reactor migration: randomSoundMode → randomErrorSound");
    }
  } catch (err) {
    console.error("Reactor: migration (randomSoundMode → randomErrorSound) failed:", err);
  }
}

/**
 * Reads initial config, registers all event listeners and commands,
 * and creates the status bar item.
 * @param {vscode.ExtensionContext} context
 */
function initializeExtension(context) {
  // Migration: move flat sounds/ .mp3 files into sounds/errors/ (v2.1 folder restructure)
  migrateFlatSoundsToCategories(context);

  // Migration: rename randomSoundMode → randomErrorSound in user settings
  migrateRandomSoundModeSetting();

  const config = vscode.workspace.getConfiguration("errorScreamer");
  isExtensionEnabled = config.get("enabled", true);
  isMuted = config.get("muted", false);

  // Hook terminal shell exit (VS Code 1.93+ stable API)
  if (vscode.window.onDidEndTerminalShellExecution) {
    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(onTerminalCommandFinished));
  } else {
    vscode.window.showWarningMessage("Error & Success Reactor: Terminal monitoring API not available. Please update VS Code to 1.93+.");
  }

  // Live config change listener
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onSettingsChanged));

  // --- NEW TRIGGERS (v2.0) ---

  // Diagnostic change trigger — fires when IDE errors increase in the current file
  if (vscode.languages && vscode.languages.onDidChangeDiagnostics) {
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(onDiagnosticsChanged));
  }

  // Reset diagnostic baseline when the user switches editors
  if (vscode.window.onDidChangeActiveTextEditor) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onActiveEditorChanged));
  }

  // Save trigger — fires when saving a file that still has diagnostic errors
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onDocumentSaved));

  // Task failure trigger — fires when a VS Code task process exits non-zero
  if (vscode.tasks && vscode.tasks.onDidEndTaskProcess) {
    context.subscriptions.push(vscode.tasks.onDidEndTaskProcess(onTaskProcessEnded));
  }

  // Debug exception trigger — fires when a debug session stops on an exception
  if (vscode.debug && vscode.debug.onDidTerminateDebugSession) {
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(onDebugSessionTerminated));
  }

  // Status bar item (right side, low priority)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusBarItem.command = "errorScreamer.viewTodayErrorStats";
  statusBarItem.tooltip = "Error & Success Reactor — click for today's stats";
  context.subscriptions.push(statusBarItem);
  refreshStatusBar();

  registerAllCommands(context);
}

// ---------------------------------------------------------------------------
// Terminal event handler — the main trigger point
// ---------------------------------------------------------------------------

/**
 * Fires every time a terminal shell command finishes.
 * Routes to error or success sound based on exit code and/or output pattern
 * matching, after checking all guards (enabled, muted, DND, cooldown, ignored codes).
 *
 * Detection logic:
 *   - Always checks exit code (non-zero = failure).
 *   - When errorPatternDetectionEnabled is true, also reads the terminal output
 *     stream and checks it against the configured errorPatterns list.
 *   - Sound triggers if EITHER condition is true — this catches tools that print
 *     error text but still exit with code 0 (linters, test runners, etc.).
 *
 * @param {vscode.TerminalShellExecutionEndEvent} event
 */
async function onTerminalCommandFinished(event) {
  if (!isExtensionEnabled) return;

  const exitCode = event.exitCode;
  if (exitCode === undefined) return;

  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const patternDetectionEnabled = cfg.get("errorPatternDetectionEnabled", false);

  // Optionally read terminal output for pattern matching
  let terminalOutputText = "";
  if (patternDetectionEnabled && event.execution) {
    terminalOutputText = await readTerminalExecutionOutput(event.execution);
  }

  const exitCodeIndicatesFailure = exitCode !== 0;
  const outputMatchesErrorPattern = patternDetectionEnabled && doesOutputMatchAnyErrorPattern(terminalOutputText);
  const shouldTriggerAsError = exitCodeIndicatesFailure || outputMatchesErrorPattern;

  if (!shouldTriggerAsError) {
    // Successful command — reset streak and optionally play success sound
    resetErrorStreak();
    if (!isMuted && !isDoNotDisturbActive()) {
      playSuccessSound();
    }
    return;
  }

  // Determine trigger reason for logging
  const triggerReason =
    exitCodeIndicatesFailure && outputMatchesErrorPattern ? `exit code ${exitCode} + pattern match` : exitCodeIndicatesFailure ? `exit code ${exitCode}` : "output pattern match (exit code was 0)";
  console.log(`Error & Success Reactor: error detected via ${triggerReason}`);

  // Ignored exit codes only apply to exit-code-based triggers;
  // pattern matches still fire even for ignored codes.
  if (exitCodeIndicatesFailure && !outputMatchesErrorPattern && isExitCodeIgnored(exitCode)) {
    console.log(`Error & Success Reactor: exit code ${exitCode} is in ignoredExitCodes, skipping`);
    return;
  }

  incrementErrorStreak();
  recordErrorOccurredToday();

  if (isMuted) return;
  if (isDoNotDisturbActive()) return;
  if (isCooldownActive()) {
    console.log("Error & Success Reactor: cooldown active, skipping sound");
    return;
  }

  lastErrorSoundPlayedAt = Date.now();
  const playedSoundId = playCurrentErrorSound();
  incrementLifetimeScreamCount();

  showErrorToastMessage(cfg, `exit ${exitCode}`, playedSoundId);

  if (cfg.get("escalationEnabled", false)) {
    const tier = calculateEscalationTier();
    if (tier > 0) {
      vscode.window.setStatusBarMessage(`$(flame) Error & Success Reactor: Escalation tier ${tier}! (streak: ${currentErrorStreak})`, 4000);
    }
  }
}

// ---------------------------------------------------------------------------
// New trigger handlers (v2.0)
// ---------------------------------------------------------------------------

/**
 * Fires when VS Code diagnostics change (lint errors, type errors, etc.).
 * Uses a 150ms debounce to avoid rapid-fire triggers, and only plays a sound
 * when the number of Error-severity diagnostics INCREASES.
 *
 * @param {vscode.DiagnosticChangeEvent} event
 */
function onDiagnosticsChanged(event) {
  if (!isExtensionEnabled) return;
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("playOnDiagnostics", true)) return;

  // Debounce: clear any pending check and schedule a new one
  if (diagnosticDebounceTimeout) clearTimeout(diagnosticDebounceTimeout);

  diagnosticDebounceTimeout = setTimeout(() => {
    diagnosticDebounceTimeout = null;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    let diagnostics;
    if (vscode.languages.getDiagnostics) {
      const allDiag = vscode.languages.getDiagnostics(uri);
      diagnostics = Array.isArray(allDiag) ? allDiag : [];
    } else {
      return;
    }

    const errorCount = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;

    // Only trigger when errors INCREASE (not on fixes)
    if (errorCount > previousDiagnosticErrorCount && previousDiagnosticErrorCount >= 0) {
      triggerErrorSoundFromSource("diagnostics");
    }

    previousDiagnosticErrorCount = errorCount;
  }, 150);
}

/**
 * Resets the diagnostic baseline when the user switches to a different editor.
 * Without this, switching files would falsely detect "new" errors.
 *
 * @param {vscode.TextEditor | undefined} editor
 */
function onActiveEditorChanged(editor) {
  const uri = editor ? editor.document.uri.toString() : "";
  if (uri !== lastActiveEditorUri) {
    lastActiveEditorUri = uri;

    // Recalculate baseline for the new file
    if (editor && vscode.languages.getDiagnostics) {
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri) || [];
      previousDiagnosticErrorCount = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    } else {
      previousDiagnosticErrorCount = 0;
    }
  }
}

/**
 * Fires after a document is saved. If the saved document still has
 * Error-severity diagnostics, trigger the error sound.
 *
 * @param {vscode.TextDocument} document
 */
function onDocumentSaved(document) {
  if (!isExtensionEnabled) return;
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("playOnSave", true)) return;

  if (!vscode.languages.getDiagnostics) return;

  const diagnostics = vscode.languages.getDiagnostics(document.uri) || [];
  const hasErrors = diagnostics.some((d) => d.severity === vscode.DiagnosticSeverity.Error);

  if (hasErrors) {
    triggerErrorSoundFromSource("save");
  }
}

/**
 * Fires when a VS Code task's underlying process ends.
 * Triggers the error sound if the exit code is non-zero.
 *
 * @param {vscode.TaskProcessEndEvent} event
 */
function onTaskProcessEnded(event) {
  if (!isExtensionEnabled) return;
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("playOnTaskFailure", true)) return;

  if (event.exitCode !== undefined && event.exitCode !== 0) {
    triggerErrorSoundFromSource("task");
  }
}

/**
 * Fires when a debug session terminates.
 * We currently trigger on any debug session termination that is abnormal
 * (heuristic: the user can toggle this off). True crash detection would
 * require onDidReceiveDebugSessionCustomEvent for 'stopped' with reason
 * 'exception', but that's adapter-specific. This is a practical fallback.
 *
 * @param {vscode.DebugSession} session
 */
function onDebugSessionTerminated(session) {
  if (!isExtensionEnabled) return;
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("playOnDebuggerCrash", true)) return;

  // Trigger on every debug session termination when enabled.
  // Users who only want it on exceptions should leave it off.
  triggerErrorSoundFromSource("debugger");
}

/**
 * Shared error sound trigger used by all non-terminal sources.
 * Runs the standard guard chain (muted → DND → cooldown) then plays the sound.
 *
 * @param {string} source  Description of what triggered the sound (for logging/toast)
 */
function triggerErrorSoundFromSource(source) {
  console.log(`Error & Success Reactor: error detected via ${source}`);

  incrementErrorStreak();
  recordErrorOccurredToday();

  if (isMuted) return;
  if (isDoNotDisturbActive()) return;
  if (isCooldownActive()) {
    console.log("Error & Success Reactor: cooldown active, skipping sound");
    return;
  }

  lastErrorSoundPlayedAt = Date.now();
  const playedSoundId = playCurrentErrorSound();
  incrementLifetimeScreamCount();

  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  showErrorToastMessage(cfg, source, playedSoundId);

  if (cfg.get("escalationEnabled", false)) {
    const tier = calculateEscalationTier();
    if (tier > 0) {
      vscode.window.setStatusBarMessage(`$(flame) Error & Success Reactor: Escalation tier ${tier}! (streak: ${currentErrorStreak})`, 4000);
    }
  }
}

/**
 * Shows a toast notification after an error sound plays.
 * Uses funny messages when funnyToasts is enabled, plain info otherwise.
 *
 * @param {vscode.WorkspaceConfiguration} cfg
 * @param {string} detail   e.g. "exit 1" or "diagnostics"
 * @param {string|undefined} playedSoundId
 */
function showErrorToastMessage(cfg, detail, playedSoundId) {
  if (!playedSoundId) return;
  if (!cfg.get("showErrorToast", false)) return;

  const useFunny = cfg.get("funnyToasts", true);
  if (useFunny) {
    const msg = FUNNY_TOASTS[Math.floor(Math.random() * FUNNY_TOASTS.length)];
    vscode.window.showWarningMessage(`Error & Success Reactor [${detail}]: ${msg}`);
  } else {
    vscode.window.showInformationMessage(`🔊 Error & Success Reactor: ${detail} — ${resolveSoundLabel(playedSoundId)}`);
  }
}

/**
 * Increments the persistent lifetime scream count.
 */
function incrementLifetimeScreamCount() {
  if (!extensionCtx) return;
  const current = extensionCtx.globalState.get(LIFETIME_SCREAM_KEY, 0);
  extensionCtx.globalState.update(LIFETIME_SCREAM_KEY, current + 1);
}

/**
 * Returns the persistent lifetime scream count.
 * @returns {number}
 */
function getLifetimeScreamCount() {
  if (!extensionCtx) return 0;
  return extensionCtx.globalState.get(LIFETIME_SCREAM_KEY, 0);
}

/**
 * Resets the persistent lifetime scream count to zero.
 */
async function resetLifetimeScreamCount() {
  if (!extensionCtx) return;
  await extensionCtx.globalState.update(LIFETIME_SCREAM_KEY, 0);
  vscode.window.showInformationMessage("Error & Success Reactor: Lifetime scream counter reset to 0.");
}

/**
 * Reads all output chunks from a terminal shell execution's async iterable
 * and concatenates them into a single string.
 * Returns an empty string if the stream is unavailable or errors.
 *
 * @param {vscode.TerminalShellExecution} execution
 * @returns {Promise<string>}
 */
async function readTerminalExecutionOutput(execution) {
  try {
    let output = "";
    for await (const chunk of execution.read()) {
      output += chunk;
    }
    return output;
  } catch (err) {
    console.log("Error & Success Reactor: could not read terminal execution output —", err.message);
    return "";
  }
}

/**
 * Checks whether the given terminal output text contains any of the
 * configured errorPatterns (case-sensitive substring match).
 * Returns false if pattern detection is unconfigured or text is empty.
 *
 * @param {string} outputText
 * @returns {boolean}
 */
function doesOutputMatchAnyErrorPattern(outputText) {
  if (!outputText || outputText.trim().length === 0) return false;
  const patterns = vscode.workspace.getConfiguration("errorScreamer").get("errorPatterns", []);
  return patterns.some((pattern) => outputText.includes(pattern));
}

/**
 * Re-reads live settings when the user changes VS Code configuration.
 * @param {vscode.ConfigurationChangeEvent} event
 */
function onSettingsChanged(event) {
  if (event.affectsConfiguration("errorScreamer.enabled")) {
    isExtensionEnabled = vscode.workspace.getConfiguration("errorScreamer").get("enabled", true);
  }
  if (event.affectsConfiguration("errorScreamer.muted")) {
    isMuted = vscode.workspace.getConfiguration("errorScreamer").get("muted", false);
    refreshStatusBar();
  }
  // Push fresh state to the settings panel webview if it is currently open
  if (settingsPanelInstance) {
    settingsPanelInstance.webview.postMessage({ type: "state", data: getFullSettingsState() });
  }
}

// ---------------------------------------------------------------------------
// Sound discovery and selection
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to a sound file given its category and id.
 * @param {"errors"|"success"} category
 * @param {string} soundId
 * @returns {string}
 */
function getSoundFilePath(category, soundId) {
  return path.join(extensionCtx.extensionPath, "sounds", category, `${soundId}.mp3`);
}

/**
 * Scans a specific category subfolder under sounds/ and returns all usable
 * sound files in that category.  Results are cached per-category for up to
 * SOUND_CACHE_TTL_MS.
 * @param {"errors"|"success"} category
 * @returns {{ id: string, category: string, filePath: string, label: string, enabled: boolean }[]}
 */
function discoverSoundsByCategory(category) {
  const now = Date.now();
  const tsKey = category + "Ts";
  if (soundCache[category] && now - soundCache[tsKey] < SOUND_CACHE_TTL_MS) {
    return soundCache[category];
  }

  const catDir = path.join(extensionCtx.extensionPath, "sounds", category);
  if (!fs.existsSync(catDir)) {
    soundCache[category] = [];
    soundCache[tsKey] = now;
    return [];
  }

  soundCache[category] = fs
    .readdirSync(catDir)
    .filter((filename) => filename.toLowerCase().endsWith(".mp3"))
    .map((filename) => {
      const id = filename.replace(/\.mp3$/i, "");
      const settings = loadSettingsForSound(id);
      return {
        id,
        category,
        filePath: path.join(catDir, filename),
        label: resolveSoundLabel(id),
        enabled: settings.enabled !== false,
      };
    });
  soundCache[tsKey] = now;
  return soundCache[category];
}

/** Convenience: discover error sounds only. */
function discoverErrorSounds() {
  return discoverSoundsByCategory("errors");
}

/** Convenience: discover success sounds only. */
function discoverSuccessSounds() {
  return discoverSoundsByCategory("success");
}

/**
 * Returns all sounds across both categories (backward-compat helper).
 * @returns {{ id: string, category: string, filePath: string, label: string, enabled: boolean }[]}
 */
function discoverAvailableSounds() {
  return [...discoverErrorSounds(), ...discoverSuccessSounds()];
}

/**
 * Invalidates the sound discovery cache (call after importing/deleting sounds).
 */
function invalidateSoundCache() {
  soundCache.errors = null;
  soundCache.success = null;
  soundCache.errorsTs = 0;
  soundCache.successTs = 0;
}

/**
 * Converts a raw filename (without extension) into a human-readable default label.
 * Example: "aaahhhhhh" → "Aaahhhhhh", "my_scream" → "My_scream"
 * @param {string} soundId
 * @returns {string}
 */
function buildDefaultSoundLabel(soundId) {
  if (!soundId) return "";
  return soundId.charAt(0).toUpperCase() + soundId.slice(1);
}

/**
 * Returns the display label for a sound — custom label if set, else the default.
 * @param {string} soundId
 * @returns {string}
 */
function resolveSoundLabel(soundId) {
  const settings = loadSettingsForSound(soundId);
  if (settings.customLabel && settings.customLabel.trim().length > 0) {
    return settings.customLabel.trim();
  }
  return buildDefaultSoundLabel(soundId);
}

/**
 * Shows a VS Code QuickPick populated with all discovered sounds.
 * On selection, persists the new active sound to global config.
 */
async function showSoundSelectorQuickPick() {
  const sounds = discoverErrorSounds();
  if (sounds.length === 0) {
    vscode.window.showWarningMessage("Error & Success Reactor: No .mp3 files found in the sounds/errors/ folder.");
    return;
  }

  const currentActiveId = vscode.workspace.getConfiguration("errorScreamer").get("activeSound", "aahh");

  const items = sounds.map((s) => ({
    label: s.label,
    description: s.id,
    detail: s.enabled ? "$(check) enabled" : "$(circle-slash) disabled",
    picked: s.id === currentActiveId,
    id: s.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select the error sound to play",
    title: "Error & Success Reactor — Select Error Sound",
  });

  if (!picked) return;

  await vscode.workspace.getConfiguration("errorScreamer").update("activeSound", picked.id, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(`Error & Success Reactor: Active sound set to "${picked.label}"`);
}

// ---------------------------------------------------------------------------
// Per-sound settings — storage and retrieval
// ---------------------------------------------------------------------------

const PER_SOUND_SETTINGS_KEY = "errorScreamer.perSoundSettings";

/**
 * Returns the full per-sound settings object from extension global state.
 * Structure: { [soundId]: { volume, speed, pitch, reversePlayback, enabled, customLabel } }
 * @returns {Object}
 */
function loadAllPerSoundSettings() {
  return extensionCtx.globalState.get(PER_SOUND_SETTINGS_KEY, {});
}

/**
 * Returns the persisted settings for a single sound, with sensible defaults.
 * @param {string} soundId
 * @returns {{ volume: number, speed: number, pitch: number, reversePlayback: boolean, enabled: boolean, customLabel: string }}
 */
function loadSettingsForSound(soundId) {
  const all = loadAllPerSoundSettings();
  const saved = all[soundId] || {};
  return {
    volume: saved.volume !== undefined ? saved.volume : 0.5,
    speed: saved.speed !== undefined ? saved.speed : 1.0,
    pitch: saved.pitch !== undefined ? saved.pitch : 1.0,
    reversePlayback: saved.reversePlayback !== undefined ? saved.reversePlayback : false,
    enabled: saved.enabled !== undefined ? saved.enabled : true,
    customLabel: saved.customLabel !== undefined ? saved.customLabel : "",
  };
}

/**
 * Merges the provided partial settings into the saved settings for a sound,
 * then persists the updated object to global state.
 * @param {string} soundId
 * @param {Partial<{volume: number, speed: number, pitch: number, reversePlayback: boolean, enabled: boolean, customLabel: string}>} partialSettings
 */
async function saveSettingsForSound(soundId, partialSettings) {
  const all = loadAllPerSoundSettings();
  all[soundId] = Object.assign(loadSettingsForSound(soundId), partialSettings);
  await extensionCtx.globalState.update(PER_SOUND_SETTINGS_KEY, all);
}

/**
 * Returns the effective volume for a sound after applying escalation boost.
 * Volume is clamped to [0, 1].
 * @param {string} soundId
 * @returns {number}
 */
function getEffectiveVolumeForSound(soundId) {
  const { volume } = loadSettingsForSound(soundId);
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("escalationEnabled", false)) return volume;

  const tier = calculateEscalationTier();
  const boost = cfg.get("escalationVolumeBoost", 0.2);
  return Math.min(1, volume + tier * boost);
}

/**
 * Returns the effective playback speed for a sound after applying escalation boost.
 * Speed is clamped to [0.5, 4.0].
 * @param {string} soundId
 * @returns {number}
 */
function getEffectiveSpeedForSound(soundId) {
  const { speed } = loadSettingsForSound(soundId);
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("escalationEnabled", false)) return speed;

  const tier = calculateEscalationTier();
  const boost = cfg.get("escalationSpeedBoost", 0.3);
  return Math.min(4.0, Math.max(0.5, speed + tier * boost));
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/**
 * Resolves which sound to play (active sound or random), loads its settings,
 * and fires executeSoundPlayback.
 */
function playCurrentErrorSound() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const useRandom = cfg.get("randomErrorSound", false);

  let soundId;
  if (useRandom) {
    const enabledSounds = discoverErrorSounds().filter((s) => s.enabled);
    if (enabledSounds.length === 0) return;
    soundId = enabledSounds[Math.floor(Math.random() * enabledSounds.length)].id;
  } else {
    soundId = cfg.get("activeSound", "aahh");
  }

  const soundFilePath = getSoundFilePath("errors", soundId);

  if (!fs.existsSync(soundFilePath)) {
    vscode.window.showWarningMessage(`Error & Success Reactor: Sound file not found — ${soundFilePath}`);
    return;
  }

  const settings = loadSettingsForSound(soundId);
  if (!settings.enabled) return;

  const volume = getEffectiveVolumeForSound(soundId);
  const speed = getEffectiveSpeedForSound(soundId);
  const pitch = settings.pitch;
  const reverse = settings.reversePlayback;

  console.log(`Error & Success Reactor: playing "${soundId}" vol=${volume} speed=${speed} pitch=${pitch} reverse=${reverse}`);
  executeSoundPlayback(soundFilePath, volume, speed, pitch, reverse);
  return soundId;
}

/**
 * Plays the configured success sound (if one is set and the file exists).
 * Success sounds use their own cooldown timer, independent of error sounds.
 */
function playSuccessSound() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const useRandom = cfg.get("randomSuccessSound", false);

  let successSoundId;
  if (useRandom) {
    const enabledSounds = discoverSuccessSounds().filter((s) => s.enabled);
    if (enabledSounds.length === 0) return;
    successSoundId = enabledSounds[Math.floor(Math.random() * enabledSounds.length)].id;
  } else {
    successSoundId = cfg.get("successSound", "mission-passed");
    if (!successSoundId || successSoundId.trim() === "") return;
  }

  // Success sounds have their own cooldown (default 5s) to prevent spam
  const successCooldown = cfg.get("successCooldownSeconds", 5);
  if (Date.now() - lastSuccessSoundPlayedAt < successCooldown * 1000) return;

  const soundFilePath = getSoundFilePath("success", successSoundId);
  if (!fs.existsSync(soundFilePath)) return;

  lastSuccessSoundPlayedAt = Date.now();
  const settings = loadSettingsForSound(successSoundId);
  executeSoundPlayback(soundFilePath, settings.volume, settings.speed, settings.pitch, false);
}

/**
 * Dispatches to the correct platform-specific playback command builder,
 * then fires the command via child_process.exec.
 * Falls back to basic playback if ffmpeg is unavailable and advanced options are needed.
 *
 * @param {string} soundFilePath   Absolute path to the .mp3 file
 * @param {number} volume          0.0 – 1.0
 * @param {number} speed           0.5 – 4.0  (1.0 = normal)
 * @param {number} pitch           0.5 – 2.0  (1.0 = normal)
 * @param {boolean} reverse        Play the audio backwards
 */
function executeSoundPlayback(soundFilePath, volume, speed, pitch, reverse) {
  const needsProcessing = reverse || speed !== 1.0 || pitch !== 1.0;

  // FAST PATH: When no audio processing is needed and sound-play is available,
  // use it directly — no shell spawn, ~50-100ms latency vs ~700ms with PowerShell.
  if (!needsProcessing && soundPlay) {
    soundPlay.play(soundFilePath, volume).catch((err) => {
      console.error("Error & Success Reactor: sound-play failed, falling back to exec:", err.message);
      // Fallback to platform-specific exec if sound-play fails
      executeSoundPlaybackViaExec(soundFilePath, volume, speed, pitch, reverse);
    });
    return;
  }

  // SLOW PATH: Advanced audio processing (speed/pitch/reverse) requires ffmpeg
  // via platform-specific shell commands.
  executeSoundPlaybackViaExec(soundFilePath, volume, speed, pitch, reverse);
}

/**
 * Legacy exec-based playback — spawns a platform-specific shell command.
 * Used as fallback when sound-play is unavailable, or when ffmpeg processing
 * (speed/pitch/reverse) is needed.
 */
function executeSoundPlaybackViaExec(soundFilePath, volume, speed, pitch, reverse) {
  try {
    let command;
    if (process.platform === "win32") {
      command = buildWindowsPlaybackCommand(soundFilePath, volume, speed, pitch, reverse);
    } else if (process.platform === "darwin") {
      command = buildMacPlaybackCommand(soundFilePath, volume, speed, pitch, reverse);
    } else {
      command = buildLinuxPlaybackCommand(soundFilePath, volume, speed, pitch, reverse);
    }

    exec(command, (err) => {
      if (err) {
        console.error("Error & Success Reactor: playback command failed:", err.message);
      }
    });
  } catch (err) {
    console.error("Error & Success Reactor: executeSoundPlaybackViaExec error:", err);
  }
}

/**
 * Returns a Windows PowerShell + optional ffmpeg playback command.
 * When speed/pitch/reverse differ from defaults, ffmpeg writes a temp file
 * which PowerShell then plays and cleans up afterwards.
 *
 * @param {string}  filePath
 * @param {number}  volume
 * @param {number}  speed
 * @param {number}  pitch
 * @param {boolean} reverse
 * @returns {string}
 */
function buildWindowsPlaybackCommand(filePath, volume, speed, pitch, reverse) {
  const needsProcessing = reverse || speed !== 1.0 || pitch !== 1.0;
  const safeFilePath = filePath.replace(/'/g, "''");

  if (!needsProcessing) {
    // Simple path: PowerShell MediaPlayer with volume
    // NOTE: Add-Type MUST come before New-Object or PowerShell cannot resolve the type.
    return (
      `powershell -NoProfile -Command "` +
      `Add-Type -AssemblyName PresentationCore; ` +
      `$p = New-Object System.Windows.Media.MediaPlayer; ` +
      `$p.Open([uri]'file:///${safeFilePath.replace(/\\/g, "/")}'); ` +
      `$p.Volume = ${volume}; ` +
      `Start-Sleep -Milliseconds 500; ` +
      `$p.Play(); ` +
      `Start-Sleep -Seconds 5; ` +
      `$p.Close()"`
    );
  }

  // Advanced path: ffmpeg pre-processes to a temp file, PowerShell plays it
  const tempFile = path.join(os.tmpdir(), `error_screamer_${Date.now()}.wav`).replace(/\\/g, "/");
  const audioFilters = buildFfmpegAudioFilterChain(speed, pitch, reverse);
  const safeInput = filePath.replace(/\\/g, "/").replace(/'/g, "\\'");

  return (
    `powershell -NoProfile -Command "` +
    `& ffmpeg -y -i '${safeInput}' -af '${audioFilters}' '${tempFile}' 2>$null; ` +
    `if (Test-Path '${tempFile}') { ` +
    `Add-Type -AssemblyName PresentationCore; ` +
    `$p = New-Object System.Windows.Media.MediaPlayer; ` +
    `$p.Open([uri]'file:///${tempFile}'); ` +
    `$p.Volume = ${volume}; ` +
    `Start-Sleep -Milliseconds 300; ` +
    `$p.Play(); ` +
    `Start-Sleep -Seconds 5; ` +
    `$p.Close(); ` +
    `Remove-Item '${tempFile}' -ErrorAction SilentlyContinue ` +
    `}"`
  );
}

/**
 * Returns a macOS afplay command, using ffmpeg piping when advanced audio
 * processing (speed / pitch / reverse) is needed.
 *
 * @param {string}  filePath
 * @param {number}  volume
 * @param {number}  speed
 * @param {number}  pitch
 * @param {boolean} reverse
 * @returns {string}
 */
function buildMacPlaybackCommand(filePath, volume, speed, pitch, reverse) {
  const safeFilePath = filePath.replace(/"/g, '\\"');
  const needsProcessing = reverse || speed !== 1.0 || pitch !== 1.0;

  if (!needsProcessing) {
    return `afplay "${safeFilePath}" -v ${volume}`;
  }

  // ffmpeg pipes processed audio into afplay via stdout
  const audioFilters = buildFfmpegAudioFilterChain(speed, pitch, reverse);
  return `ffmpeg -i "${safeFilePath}" -af "${audioFilters}" -f wav - 2>/dev/null | afplay -v ${volume} -`;
}

/**
 * Returns a Linux ffplay command (with paplay / aplay fallbacks).
 * Uses ffplay's -af option for audio filter processing.
 *
 * @param {string}  filePath
 * @param {number}  volume
 * @param {number}  speed
 * @param {number}  pitch
 * @param {boolean} reverse
 * @returns {string}
 */
function buildLinuxPlaybackCommand(filePath, volume, speed, pitch, reverse) {
  const safeFilePath = filePath.replace(/"/g, '\\"');
  const volumePercent = Math.round(volume * 100);
  const needsProcessing = reverse || speed !== 1.0 || pitch !== 1.0;

  if (!needsProcessing) {
    return `ffplay -nodisp -autoexit -volume ${volumePercent} "${safeFilePath}" 2>/dev/null` + ` || paplay "${safeFilePath}" 2>/dev/null` + ` || aplay "${safeFilePath}" 2>/dev/null`;
  }

  const audioFilters = buildFfmpegAudioFilterChain(speed, pitch, reverse);
  return (
    `ffplay -nodisp -autoexit -volume ${volumePercent} -af "${audioFilters}" "${safeFilePath}" 2>/dev/null` +
    ` || ffmpeg -i "${safeFilePath}" -af "${audioFilters}" -f wav - 2>/dev/null | aplay 2>/dev/null`
  );
}

/**
 * Builds an ffmpeg -af filter chain string for the requested audio transformations.
 * Handles speed (atempo), pitch (asetrate + aresample), and reverse (areverse).
 *
 * atempo only accepts values in [0.5, 2.0]; for values outside this range
 * we chain multiple atempo filters.
 *
 * @param {number}  speed    0.5 – 4.0
 * @param {number}  pitch    0.5 – 2.0  (changes pitch independently of speed via sample rate trick)
 * @param {boolean} reverse
 * @returns {string}  e.g. "areverse,asetrate=44100*1.5,aresample=44100,atempo=1.5"
 */
function buildFfmpegAudioFilterChain(speed, pitch, reverse) {
  const filters = [];

  if (reverse) {
    filters.push("areverse");
  }

  if (pitch !== 1.0) {
    const baseSampleRate = 44100;
    filters.push(`asetrate=${baseSampleRate}*${pitch.toFixed(4)}`);
    filters.push(`aresample=${baseSampleRate}`);
  }

  if (speed !== 1.0) {
    // Chain atempo filters to handle values outside [0.5, 2.0]
    const atempoFilters = buildChainedAtempoFilters(speed);
    filters.push(...atempoFilters);
  }

  return filters.length > 0 ? filters.join(",") : "anull";
}

/**
 * Decomposes a target speed into a chain of atempo values each in [0.5, 2.0],
 * since ffmpeg's atempo filter only accepts that range.
 *
 * @param {number} targetSpeed
 * @returns {string[]}  e.g. ["atempo=2.0","atempo=2.0"] for 4x speed
 */
function buildChainedAtempoFilters(targetSpeed) {
  const result = [];
  let remaining = targetSpeed;

  if (remaining > 1.0) {
    while (remaining > 2.0) {
      result.push("atempo=2.0");
      remaining /= 2.0;
    }
    result.push(`atempo=${remaining.toFixed(4)}`);
  } else if (remaining < 1.0) {
    while (remaining < 0.5) {
      result.push("atempo=0.5");
      remaining /= 0.5;
    }
    result.push(`atempo=${remaining.toFixed(4)}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Guards and checks
// ---------------------------------------------------------------------------

/**
 * Returns true if the cooldown window has not yet elapsed since the last play.
 * @returns {boolean}
 */
function isCooldownActive() {
  const cooldownSeconds = vscode.workspace.getConfiguration("errorScreamer").get("cooldownSeconds", 3);
  return Date.now() - lastErrorSoundPlayedAt < cooldownSeconds * 1000;
}

/**
 * Returns true if the provided exit code is in the user's ignored exit codes list.
 * @param {number} exitCode
 * @returns {boolean}
 */
function isExitCodeIgnored(exitCode) {
  const ignored = vscode.workspace.getConfiguration("errorScreamer").get("ignoredExitCodes", []);
  return ignored.includes(exitCode);
}

/**
 * Returns true if the current time falls inside the Do Not Disturb window.
 * Handles overnight windows (e.g. 23:00 – 08:00) correctly.
 * @returns {boolean}
 */
function isDoNotDisturbActive() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("doNotDisturbEnabled", false)) return false;

  const startStr = cfg.get("doNotDisturbStart", "23:00");
  const endStr = cfg.get("doNotDisturbEnd", "08:00");

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = startStr.split(":").map(Number);
  const [endH, endM] = endStr.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same-day window (e.g. 09:00 – 17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // Overnight window (e.g. 23:00 – 08:00)
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

// ---------------------------------------------------------------------------
// Error streak, escalation, and status bar
// ---------------------------------------------------------------------------

/**
 * Increments the consecutive error streak counter and refreshes the status bar.
 */
function incrementErrorStreak() {
  currentErrorStreak++;
  refreshStatusBar();
}

/**
 * Resets the consecutive error streak counter to zero and refreshes the status bar.
 */
function resetErrorStreak() {
  currentErrorStreak = 0;
  refreshStatusBar();
}

/**
 * Returns how many escalation tiers above the threshold the current streak sits.
 * Returns 0 if escalation is not enabled or threshold has not been crossed.
 * @returns {number}
 */
function calculateEscalationTier() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  if (!cfg.get("escalationEnabled", false)) return 0;
  const threshold = cfg.get("escalationThreshold", 3);
  return Math.max(0, currentErrorStreak - threshold);
}

/**
 * Updates the status bar item to reflect current mute state and error streak.
 * Hidden when the streak is 0 and the extension is not muted.
 */
function refreshStatusBar() {
  if (!statusBarItem) return;

  if (isMuted) {
    statusBarItem.text = "$(bell-slash) Screamer muted";
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  if (currentErrorStreak === 0) {
    statusBarItem.hide();
    return;
  }

  const tier = calculateEscalationTier();
  const streakLabel = `$(warning) Streak: ${currentErrorStreak}`;
  statusBarItem.text = tier > 0 ? `$(flame) ${streakLabel} (+${tier} escalation)` : streakLabel;
  statusBarItem.backgroundColor = tier > 0 ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
  statusBarItem.show();
}

// ---------------------------------------------------------------------------
// Daily error stats
// ---------------------------------------------------------------------------

const DAILY_STATS_KEY = "errorScreamer.dailyStats";

/**
 * Returns today's date as a YYYY-MM-DD string (local time).
 * @returns {string}
 */
function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Increments today's error count in global state.
 */
async function recordErrorOccurredToday() {
  const stats = extensionCtx.globalState.get(DAILY_STATS_KEY, {});
  const today = getTodayDateString();
  stats[today] = (stats[today] || 0) + 1;
  await extensionCtx.globalState.update(DAILY_STATS_KEY, stats);
}

/**
 * Returns the number of errors that triggered a sound today.
 * @returns {number}
 */
function getTodayErrorCount() {
  const stats = extensionCtx.globalState.get(DAILY_STATS_KEY, {});
  return stats[getTodayDateString()] || 0;
}

/**
 * Shows an information message summarising today's error count.
 */
function showTodayErrorStats() {
  const count = getTodayErrorCount();
  const streakInfo = currentErrorStreak > 0 ? ` Current streak: ${currentErrorStreak}.` : "";
  vscode.window.showInformationMessage(`Error & Success Reactor: You triggered ${count} error sound${count === 1 ? "" : "s"} today.${streakInfo}`);
}

// ---------------------------------------------------------------------------
// Settings panel — webview UI for all settings
// ---------------------------------------------------------------------------

/**
 * Packages all current state into a plain object for the settings panel webview.
 * @returns {Object}
 */
function getFullSettingsState() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const errorSounds = discoverErrorSounds();
  const successSounds = discoverSuccessSounds();
  const allSounds = [...errorSounds, ...successSounds];
  const perSoundSettings = {};
  for (const s of allSounds) {
    perSoundSettings[s.id] = loadSettingsForSound(s.id);
  }
  return {
    globalSettings: {
      enabled: cfg.get("enabled", true),
      muted: cfg.get("muted", false),
      activeSound: cfg.get("activeSound", "aahh"),
      successSound: cfg.get("successSound", "mission-passed"),
      randomErrorSound: cfg.get("randomErrorSound", false),
      randomSuccessSound: cfg.get("randomSuccessSound", false),
      cooldownSeconds: cfg.get("cooldownSeconds", 3),
      showErrorToast: cfg.get("showErrorToast", false),
      funnyToasts: cfg.get("funnyToasts", true),
      playOnDiagnostics: cfg.get("playOnDiagnostics", true),
      playOnSave: cfg.get("playOnSave", true),
      playOnTaskFailure: cfg.get("playOnTaskFailure", true),
      playOnDebuggerCrash: cfg.get("playOnDebuggerCrash", true),
      diagnosticDebounceMs: cfg.get("diagnosticDebounceMs", 150),
      doNotDisturbEnabled: cfg.get("doNotDisturbEnabled", false),
      doNotDisturbStart: cfg.get("doNotDisturbStart", "23:00"),
      doNotDisturbEnd: cfg.get("doNotDisturbEnd", "08:00"),
      escalationEnabled: cfg.get("escalationEnabled", false),
      escalationThreshold: cfg.get("escalationThreshold", 3),
      escalationVolumeBoost: cfg.get("escalationVolumeBoost", 0.2),
      escalationSpeedBoost: cfg.get("escalationSpeedBoost", 0.3),
      errorPatternDetectionEnabled: cfg.get("errorPatternDetectionEnabled", false),
      errorPatterns: cfg.get("errorPatterns", []),
      ignoredExitCodes: cfg.get("ignoredExitCodes", []),
    },
    errorSounds: errorSounds.map((s) => ({ id: s.id, category: s.category, label: s.label, enabled: s.enabled })),
    successSounds: successSounds.map((s) => ({ id: s.id, category: s.category, label: s.label, enabled: s.enabled })),
    sounds: allSounds.map((s) => ({ id: s.id, category: s.category, label: s.label, enabled: s.enabled })),
    perSoundSettings,
    stats: {
      todayCount: getTodayErrorCount(),
      currentStreak: currentErrorStreak,
      lifetimeScreams: getLifetimeScreamCount(),
      allStats: extensionCtx.globalState.get(DAILY_STATS_KEY, {}),
    },
  };
}

/**
 * Opens (or reveals) the Error & Success Reactor settings panel.
 * All settings are rendered inside a webview with live controls.
 */
function openSettingsPanel() {
  if (settingsPanelInstance) {
    settingsPanelInstance.reveal(vscode.ViewColumn.One);
    settingsPanelInstance.webview.postMessage({ type: "state", data: getFullSettingsState() });
    return;
  }
  const panel = vscode.window.createWebviewPanel("errorScreamerSettings", "Error & Success Reactor \u2014 Settings", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
  settingsPanelInstance = panel;
  // Register message handler BEFORE setting HTML to avoid losing the initial "ready" message
  panel.webview.onDidReceiveMessage((msg) => handleSettingsPanelMessage(panel, msg));
  panel.webview.html = buildSettingsPanelHtml();
  panel.onDidDispose(() => {
    settingsPanelInstance = null;
  });
  // Proactively push state in case the webview's "ready" message fired before the listener attached
  setTimeout(() => {
    if (settingsPanelInstance === panel) {
      panel.webview.postMessage({ type: "state", data: getFullSettingsState() });
    }
  }, 200);
}

/**
 * Handles all messages posted from the settings panel webview to the extension host.
 * @param {vscode.WebviewPanel} panel
 * @param {Object} msg
 */
async function handleSettingsPanelMessage(panel, msg) {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const refresh = () => panel.webview.postMessage({ type: "state", data: getFullSettingsState() });

  switch (msg.type) {
    case "ready":
      refresh();
      break;
    case "saveGlobal":
      await cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
      if (msg.key === "enabled") {
        isExtensionEnabled = msg.value;
      }
      if (msg.key === "muted") {
        isMuted = msg.value;
        refreshStatusBar();
      }
      refresh();
      break;
    case "savePerSound":
      await saveSettingsForSound(msg.soundId, { [msg.key]: msg.value });
      refresh();
      break;
    case "testSound": {
      const cat = msg.category || "errors";
      const fp = getSoundFilePath(cat, msg.soundId);
      if (fs.existsSync(fp)) {
        const s = loadSettingsForSound(msg.soundId);
        executeSoundPlayback(fp, s.volume, s.speed, s.pitch, s.reversePlayback);
      }
      break;
    }
    case "importSound":
      await showImportSoundFilePicker();
      refresh();
      break;
    case "deleteSound": {
      const cat = msg.category || "errors";
      const fp = getSoundFilePath(cat, msg.soundId);
      if (!fs.existsSync(fp)) break;
      const confirm = await vscode.window.showWarningMessage('Delete "' + msg.soundId + '.mp3" permanently from sounds/' + cat + "/?", { modal: true }, "Delete");
      if (confirm === "Delete") {
        fs.unlinkSync(fp);
        invalidateSoundCache();
        if (cat === "errors") {
          const remaining = discoverErrorSounds();
          if (cfg.get("activeSound", "") === msg.soundId && remaining.length > 0) {
            await cfg.update("activeSound", remaining[0].id, vscode.ConfigurationTarget.Global);
          }
        } else {
          const remaining = discoverSuccessSounds();
          if (cfg.get("successSound", "") === msg.soundId && remaining.length > 0) {
            await cfg.update("successSound", remaining[0].id, vscode.ConfigurationTarget.Global);
          }
        }
        refresh();
      }
      break;
    }
    case "addPattern": {
      const patterns = [...cfg.get("errorPatterns", [])];
      if (msg.pattern && !patterns.includes(msg.pattern)) {
        patterns.push(msg.pattern);
        await cfg.update("errorPatterns", patterns, vscode.ConfigurationTarget.Global);
      }
      refresh();
      break;
    }
    case "removePattern": {
      const patterns = cfg.get("errorPatterns", []).filter((pt) => pt !== msg.pattern);
      await cfg.update("errorPatterns", patterns, vscode.ConfigurationTarget.Global);
      refresh();
      break;
    }
    case "addIgnoredCode": {
      const code = parseInt(msg.code);
      if (!isNaN(code)) {
        const codes = [...cfg.get("ignoredExitCodes", [])];
        if (!codes.includes(code)) {
          codes.push(code);
          await cfg.update("ignoredExitCodes", codes, vscode.ConfigurationTarget.Global);
        }
      }
      refresh();
      break;
    }
    case "removeIgnoredCode": {
      const codes = cfg.get("ignoredExitCodes", []).filter((c) => c !== msg.code);
      await cfg.update("ignoredExitCodes", codes, vscode.ConfigurationTarget.Global);
      refresh();
      break;
    }
  }
}

/**
 * Builds the full HTML for the settings panel webview.
 * Client-side JS (no framework) handles all rendering. On load the webview
 * posts a "ready" message; the extension host responds with the full state
 * via postMessage, which triggers the first render.
 * @returns {string}
 */
function buildSettingsPanelHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Error & Success Reactor \u2014 Settings</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-foreground,#ccc);font-family:var(--vscode-font-family,'Segoe UI',sans-serif);font-size:13px;line-height:1.6;padding-bottom:80px}
input,select{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:3px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none}
input:focus,select:focus{border-color:var(--vscode-focusBorder,#007acc)}
input[type=range]{background:transparent;border:none;padding:0;width:100%;cursor:pointer;height:16px;vertical-align:middle}
button{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:3px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
button:hover{opacity:.85}
button.sec{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
button.danger{background:#8b2020;color:#fff}button.danger:hover{background:#b02020}
button.sm{padding:3px 8px;font-size:11px}
header{background:var(--vscode-sideBar-background,#252526);border-bottom:1px solid var(--vscode-panel-border,#444);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;flex-wrap:wrap}
header h1{font-size:15px;font-weight:600;flex:1}
.stl{font-size:11px;opacity:.65}
.main{padding:18px 20px;max-width:960px}
.section{background:var(--vscode-sideBar-background,#252526);border:1px solid var(--vscode-panel-border,#444);border-radius:6px;margin-bottom:14px;overflow:hidden}
.sh{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none}
.sh.open{border-bottom:1px solid var(--vscode-panel-border,#444)}
.sh h2{font-size:12px;font-weight:600;flex:1;letter-spacing:.3px}
.sb{padding:12px 14px}
.row{display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:center;padding:5px 0;min-height:28px}
.row label{font-size:12px;opacity:.85}
.ctl{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.hint{font-size:11px;opacity:.5}
.rblk{padding:6px 0}.rblk .lbl{font-size:12px;opacity:.85;margin-bottom:6px}
hr.sep{border:none;border-top:1px solid var(--vscode-panel-border,#444);margin:8px 0}
.sw{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;vertical-align:middle}
.sw input{opacity:0;width:0;height:0;position:absolute}
.sw .kn{position:absolute;inset:0;background:#555;border-radius:18px;cursor:pointer;transition:.18s}
.sw .kn::before{content:'';position:absolute;width:12px;height:12px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.18s}
.sw input:checked+.kn{background:var(--vscode-progressBar-background,#0e639c)}
.sw input:checked+.kn::before{transform:translateX(16px)}
.slr{display:flex;align-items:center;gap:6px;width:100%}
.slr input{flex:1;min-width:60px}
.slv{font-size:11px;opacity:.75;min-width:32px;text-align:right;flex-shrink:0}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:10px}
.sc{background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--vscode-panel-border,#444);border-radius:6px;overflow:hidden}
.sc.cur{border-color:var(--vscode-progressBar-background,#0e639c)}
.sch{display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--vscode-sideBar-background,#252526)}
.sch .nm{font-weight:600;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bdg{font-size:10px;padding:1px 5px;border-radius:8px;background:#1d4d1d;color:#86c987;flex-shrink:0}
.bdg.off{background:#4d1d1d;color:#c98686}.bdg.act{background:#0d3555;color:#64b5f6}
.scb{padding:8px 10px}.scb .row{grid-template-columns:70px 1fr;min-height:24px}
.scb .row label{font-size:11px}
.scf{display:flex;gap:5px;padding:6px 10px;border-top:1px solid var(--vscode-panel-border,#444);flex-wrap:wrap}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.tag{display:inline-flex;align-items:center;gap:3px;background:var(--vscode-badge-background,#3a3a3a);color:var(--vscode-badge-foreground,#ccc);padding:2px 7px;border-radius:9px;font-size:11px;font-family:monospace}
.tag button{background:none;color:inherit;border:none;padding:0 0 0 2px;cursor:pointer;font-size:12px;line-height:1;opacity:.6}
.tag button:hover{opacity:1;color:#e05252}
.addr{display:flex;gap:6px;margin-top:7px;align-items:center}.addr input{flex:1;min-width:0}
.statg{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.statc{background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--vscode-panel-border,#444);border-radius:6px;padding:10px 14px;min-width:90px}
.statc .v{font-size:20px;font-weight:700}.statc .k{font-size:11px;opacity:.6;margin-top:2px}
table.st{width:100%;border-collapse:collapse;font-size:12px}
table.st th,table.st td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--vscode-panel-border,#444)}
table.st th{opacity:.55;font-weight:normal;font-size:11px}
.dnd-on{font-size:11px;color:#f0a050;margin-top:5px}.dnd-off{font-size:11px;color:#86c987;margin-top:5px}
.ibar{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.sm-hint{font-size:11px;opacity:.55}
</style></head>
<body><div id="root">Loading\u2026</div>
<script>
var vscode = acquireVsCodeApi();
var S = null;
var col = {};

function post(m){ vscode.postMessage(m); }
function g(k,v){ post({type:'saveGlobal',key:k,value:v}); }
function p(sid,k,v){ post({type:'savePerSound',soundId:sid,key:k,value:v}); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function jstr(v){ return JSON.stringify(v); }

function render(){
  if(!S) return;
  var sc=window.scrollY;
  document.getElementById('root').innerHTML=buildAll();
  window.scrollTo(0,sc);
}
function sw(checked,onChange){
  return '<label class="sw"><input type="checkbox"'+(checked?' checked':'')+' onchange="'+onChange+'"><span class="kn"></span></label>';
}
function sl(val,min,max,step,onChange){
  var v=parseFloat(val).toFixed(2);
  return '<div class="slr"><input type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'" oninput="this.nextElementSibling.textContent=parseFloat(this.value).toFixed(2);('+onChange+')(parseFloat(this.value))"><span class="slv">'+v+'</span></div>';
}
function row(lbl,ctrl,hint){
  return '<div class="row"><label>'+lbl+'</label><div class="ctl">'+ctrl+(hint?' <span class="hint">'+hint+'</span>':'')+'</div></div>';
}
function sec(id,title,body){
  var open=!col[id];
  return '<div class="section"><div class="sh'+(open?' open':'')+'" onclick="toggleSec(\''+id+'\')"><h2>'+title+'</h2><span style="opacity:.4;font-size:10px">'+(open?'&#9650;':'&#9660;')+'</span></div>'+(open?'<div class="sb">'+body+'</div>':'')+'</div>';
}
function buildAll(){
  var gs=S.globalSettings;
  var totalSounds=(S.errorSounds||[]).length+(S.successSounds||[]).length;
  return buildHdr(gs)+
    '<div class="main">'+
    sec('gen','&#9881;&#65039; General',buildGeneral(gs))+
    sec('trig','&#9889; Triggers',buildTriggers(gs))+
    sec('snd','&#127925; Sound Library ('+totalSounds+' sounds)',buildSounds(gs))+
    sec('det','&#128269; Error Detection',buildDetection(gs))+
    sec('esc','&#128293; Escalation Mode',buildEscalation(gs))+
    sec('dnd','&#127769; Do Not Disturb',buildDND(gs))+
    sec('stat','&#128202; Stats',buildStats())+
    '</div>';
}
function buildHdr(gs){
  return '<header>'+
    '<span style="font-size:18px">&#128266;</span>'+
    '<h1>Error &amp; Success Reactor &#8212; Settings</h1>'+
    '<span class="stl">'+S.stats.todayCount+' errors today &nbsp;|&nbsp; streak: '+S.stats.currentStreak+'</span>'+
    sw(gs.enabled,"g('enabled',this.checked)")+
    '<span class="sm-hint">'+(gs.enabled?'On':'Off')+'</span>'+
    '<button class="sec sm" onclick="g(\'muted\','+(!gs.muted)+')">'+(gs.muted?'&#128266; Unmute':'&#128263; Mute')+'</button>'+
    '<button class="sec sm" onclick="post({type:\'importSound\'})">+ Import MP3</button>'+
    '<button class="sec sm" onclick="post({type:\'ready\'})" title="Refresh">&#8635;</button>'+
    '</header>';
}
function buildGeneral(gs){
  var errSounds=S.errorSounds||[];
  var sucSounds=S.successSounds||[];
  var aOpts=errSounds.map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===gs.activeSound?' selected':'')+'>'+esc(s.label)+'</option>';}).join('');
  var sOpts='<option value=""'+(!gs.successSound?' selected':'')+'>Disabled</option>'+
    sucSounds.map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===gs.successSound?' selected':'')+'>'+esc(s.label)+'</option>';}).join('');
  return row('Error Sound','<select onchange="g(\'activeSound\',this.value)">'+aOpts+'</select>','Sound played on failed commands (from sounds/errors/)')+
    row('Random Error Sound',sw(gs.randomErrorSound,"g('randomErrorSound',this.checked)"),'Pick a random enabled error sound on each error')+
    '<hr class="sep">'+
    row('Success Sound','<select onchange="g(\'successSound\',this.value)">'+sOpts+'</select>','Play on exit code 0 (from sounds/success/)')+
    row('Random Success Sound',sw(gs.randomSuccessSound,"g('randomSuccessSound',this.checked)"),'Pick a random enabled success sound on each success')+
    '<hr class="sep">'+
    row('Cooldown',sl(gs.cooldownSeconds,0,30,1,"function(v){g('cooldownSeconds',v)}"),'Seconds between triggers (0=no limit)')+
    row('Show Error Toast',sw(gs.showErrorToast,"g('showErrorToast',this.checked)"),'Notification popup after each sound')+
    row('Funny Toasts',sw(gs.funnyToasts,"g('funnyToasts',this.checked)"),'Use funny randomized messages instead of plain info');
}
function buildTriggers(gs){
  return row('Terminal Failures','<span class="sm-hint">Always on \u2014 core trigger</span>','Plays when a terminal command exits non-zero')+
    '<hr class="sep">'+
    row('Diagnostic Errors',sw(gs.playOnDiagnostics,"g('playOnDiagnostics',this.checked)"),'Plays when new red squiggly errors appear')+
    row('Debounce (ms)',sl(gs.diagnosticDebounceMs,50,1000,10,"function(v){g('diagnosticDebounceMs',v)}"),'Wait time before checking (prevents spam)')+
    '<hr class="sep">'+
    row('Save with Errors',sw(gs.playOnSave,"g('playOnSave',this.checked)"),'Plays when you save a file that has errors')+
    '<hr class="sep">'+
    row('Task Failure',sw(gs.playOnTaskFailure,"g('playOnTaskFailure',this.checked)"),'Plays when a VS Code task process fails')+
    '<hr class="sep">'+
    row('Debug Session End',sw(gs.playOnDebuggerCrash,"g('playOnDebuggerCrash',this.checked)"),'Plays when a debug session terminates');
}
function buildSounds(gs){
  var errSounds=S.errorSounds||[];
  var sucSounds=S.successSounds||[];
  function buildSoundCards(sounds,category,activeKey){
    if(!sounds.length) return '<div class="sm-hint" style="padding:6px 0">No .mp3 files found in sounds/'+category+'/. Import one to get started.</div>';
    var activeVal=gs[activeKey]||'';
    return sounds.map(function(s){
      var ps=S.perSoundSettings[s.id]||{};
      var isCur=s.id===activeVal;
      var bdg=isCur?'<span class="bdg act">&#9679; active</span>':(ps.enabled!==false?'<span class="bdg">enabled</span>':'<span class="bdg off">disabled</span>');
      var sid=esc(s.id);
      var vol=ps.volume!==undefined?ps.volume:0.5;
      var spd=ps.speed!==undefined?ps.speed:1;
      var pch=ps.pitch!==undefined?ps.pitch:1;
      return '<div class="sc'+(isCur?' cur':'')+'">'+
        '<div class="sch"><span class="nm">'+esc(s.label)+'</span>'+bdg+'</div>'+
        '<div class="scb">'+
          '<div class="row"><label>Label</label><div class="ctl"><input type="text" value="'+esc(ps.customLabel||'')+'" placeholder="'+sid+'" onchange="p(\''+sid+'\',\'customLabel\',this.value)" style="width:100%"></div></div>'+
          '<div class="row"><label>Volume</label><div class="ctl">'+sl(vol,0,1,0.01,"function(v){p('"+sid+"','volume',v)}")+'</div></div>'+
          '<div class="row"><label>Speed</label><div class="ctl">'+sl(spd,0.5,4,0.05,"function(v){p('"+sid+"','speed',v)}")+'</div></div>'+
          '<div class="row"><label>Pitch</label><div class="ctl">'+sl(pch,0.5,2,0.05,"function(v){p('"+sid+"','pitch',v)}")+'</div></div>'+
          '<div class="row"><label>Reverse</label><div class="ctl">'+sw(!!ps.reversePlayback,"p('"+sid+"','reversePlayback',this.checked)")+' <span class="sm-hint">needs ffmpeg</span></div></div>'+
          '<div class="row"><label>Enabled</label><div class="ctl">'+sw(ps.enabled!==false,"p('"+sid+"','enabled',this.checked)")+' <span class="sm-hint">in selector &amp; random mode</span></div></div>'+
        '</div>'+
        '<div class="scf">'+
          '<button class="sm" onclick="post({type:\'testSound\',soundId:\''+sid+'\',category:\''+category+'\'})">&#9654; Test</button>'+
          (!isCur?'<button class="sec sm" onclick="g(\''+activeKey+'\',\''+sid+'\')">Set as '+(category==='errors'?'Error':'Success')+' Sound</button>':'')+
          '<button class="danger sm" onclick="post({type:\'deleteSound\',soundId:\''+sid+'\',category:\''+category+'\'})">&#128465; Delete</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  return '<div class="ibar">'+
    '<button onclick="post({type:\'importSound\'})">+ Import MP3 from disk</button>'+
    '<span class="sm-hint">Choose a category (errors or success) when importing</span>'+
    '</div>'+
    '<h3 style="margin:12px 0 6px;opacity:.8">&#128680; Error Sounds ('+errSounds.length+')</h3>'+
    '<div class="sgrid">'+buildSoundCards(errSounds,'errors','activeSound')+'</div>'+
    '<h3 style="margin:18px 0 6px;opacity:.8">&#127881; Success Sounds ('+sucSounds.length+')</h3>'+
    '<div class="sgrid">'+buildSoundCards(sucSounds,'success','successSound')+'</div>';
}
function buildDetection(gs){
  var ptags=gs.errorPatterns.map(function(pt){
    return '<span class="tag">'+esc(pt)+'<button onclick="post({type:\'removePattern\',pattern:'+jstr(pt)+'})" title="Remove">\xd7</button></span>';
  }).join('');
  var ctags=gs.ignoredExitCodes.map(function(c){
    return '<span class="tag">'+esc(c)+'<button onclick="post({type:\'removeIgnoredCode\',code:'+c+'})" title="Remove">\xd7</button></span>';
  }).join('');
  return row('Pattern Detection',sw(gs.errorPatternDetectionEnabled,"g('errorPatternDetectionEnabled',this.checked)"),'Trigger sound on error text even when exit code = 0')+
    '<hr class="sep">'+
    '<div class="rblk"><div class="lbl">Error Patterns (case-sensitive substring match)</div>'+
    '<div class="tags">'+(ptags||'<span class="sm-hint">No patterns configured</span>')+'</div>'+
    '<div class="addr"><input id="np" type="text" placeholder="e.g.  TypeError" onkeydown="if(event.key===\'Enter\')addPat()">'+
    '<button class="sec sm" onclick="addPat()">Add</button></div></div>'+
    '<hr class="sep">'+
    '<div class="rblk"><div class="lbl">Ignored Exit Codes (skips exit-code triggers only \u2014 pattern matches still fire)</div>'+
    '<div class="tags">'+(ctags||'<span class="sm-hint">None \u2014 all non-zero codes trigger the sound</span>')+'</div>'+
    '<div class="addr"><input id="nc" type="number" placeholder="e.g.  1" style="width:70px" onkeydown="if(event.key===\'Enter\')addCode()">'+
    '<button class="sec sm" onclick="addCode()">Add</button></div></div>';
}
function buildEscalation(gs){
  return row('Enabled',sw(gs.escalationEnabled,"g('escalationEnabled',this.checked)"),'Auto-boost volume &amp; speed as error streak grows')+
    row('Threshold',sl(gs.escalationThreshold,1,20,1,"function(v){g('escalationThreshold',v)}"),'Streak count before escalation starts')+
    row('Volume Boost / Tier',sl(gs.escalationVolumeBoost,0,0.5,0.01,"function(v){g('escalationVolumeBoost',v)}"),'Volume added per tier above threshold')+
    row('Speed Boost / Tier',sl(gs.escalationSpeedBoost,0,1,0.05,"function(v){g('escalationSpeedBoost',v)}"),'Speed added per tier above threshold');
}
function buildDND(gs){
  var dndOn=isDNDActive(gs);
  return row('Enabled',sw(gs.doNotDisturbEnabled,"g('doNotDisturbEnabled',this.checked)"),'Suppress sounds during defined hours')+
    row('Start Time','<input type="text" value="'+esc(gs.doNotDisturbStart)+'" placeholder="23:00" style="width:70px" onchange="g(\'doNotDisturbStart\',this.value)">','24h HH:MM')+
    row('End Time','<input type="text" value="'+esc(gs.doNotDisturbEnd)+'" placeholder="08:00" style="width:70px" onchange="g(\'doNotDisturbEnd\',this.value)">','24h HH:MM')+
    (gs.doNotDisturbEnabled?'<div class="'+(dndOn?'dnd-on':'dnd-off')+'">'+(dndOn?'&#9679; DND active \u2014 sounds are suppressed':'&#9679; DND inactive \u2014 sounds play normally')+'</div>':'');
}
function buildStats(){
  var st=S.stats.allStats,rows='';
  for(var i=6;i>=0;i--){
    var d=new Date();d.setDate(d.getDate()-i);
    var k=d.toISOString().slice(0,10);
    var lbl=i===0?'Today':i===1?'Yesterday':d.toLocaleDateString(undefined,{weekday:'short'});
    rows+='<tr><td>'+lbl+'</td><td style="opacity:.6">'+k+'</td><td>'+(st[k]||'\u2014')+'</td></tr>';
  }
  return '<div class="statg">'+
    '<div class="statc"><div class="v">'+S.stats.todayCount+'</div><div class="k">Errors today</div></div>'+
    '<div class="statc"><div class="v">'+S.stats.currentStreak+'</div><div class="k">Current streak</div></div>'+
    '<div class="statc"><div class="v">'+S.stats.lifetimeScreams+'</div><div class="k">Lifetime screams</div></div>'+
    '</div>'+
    '<table class="st"><thead><tr><th>Day</th><th>Date</th><th>Errors triggered</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function isDNDActive(gs){
  if(!gs.doNotDisturbEnabled) return false;
  var now=new Date(),nm=now.getHours()*60+now.getMinutes();
  var sp=gs.doNotDisturbStart.split(':').map(Number),ep=gs.doNotDisturbEnd.split(':').map(Number);
  var sm=sp[0]*60+(sp[1]||0),em=ep[0]*60+(ep[1]||0);
  return sm<=em?(nm>=sm&&nm<em):(nm>=sm||nm<em);
}
function toggleSec(id){ col[id]=!col[id]; render(); }
function addPat(){ var el=document.getElementById('np'); if(el&&el.value.trim()){ post({type:'addPattern',pattern:el.value.trim()}); el.value=''; } }
function addCode(){ var el=document.getElementById('nc'); if(el&&el.value.trim()){ post({type:'addIgnoredCode',code:parseInt(el.value.trim())}); el.value=''; } }
window.addEventListener('message',function(ev){
  if(ev.data.type==='state'){
    S=ev.data.data;
    try{ render(); }
    catch(e){ document.getElementById('root').innerHTML='<div style="padding:20px;color:#e05252;font-family:monospace;font-size:12px"><b>Render error:</b><br><br>'+String(e)+'<br><br>'+(e.stack||'')+'</div>'; }
  }
});
// Ask the extension host for state — avoids embedding JSON in template literal
vscode.postMessage({type:'ready'});
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Command UI functions
// ---------------------------------------------------------------------------

/**
 * Walks the user through a multi-step input flow to adjust volume, speed,
 * and pitch for the currently active sound. Saves after each step.
 */
async function showSoundSettingsAdjuster() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const soundId = cfg.get("activeSound", "aahh");
  const current = loadSettingsForSound(soundId);
  const label = resolveSoundLabel(soundId);

  // --- Volume ---
  const volumeInput = await vscode.window.showInputBox({
    title: `Adjust Settings for "${label}" — Step 1/3: Volume`,
    prompt: "Enter volume (0.0 = silent, 1.0 = maximum)",
    value: String(current.volume),
    validateInput: (v) => {
      const n = parseFloat(v);
      if (isNaN(n) || n < 0 || n > 1) return "Must be a number between 0.0 and 1.0";
      return null;
    },
  });
  if (volumeInput === undefined) return;

  // --- Speed ---
  const speedInput = await vscode.window.showInputBox({
    title: `Adjust Settings for "${label}" — Step 2/3: Speed`,
    prompt: "Enter playback speed (0.5 = half speed, 1.0 = normal, 2.0 = double, max 4.0). Requires ffmpeg.",
    value: String(current.speed),
    validateInput: (v) => {
      const n = parseFloat(v);
      if (isNaN(n) || n < 0.5 || n > 4.0) return "Must be between 0.5 and 4.0";
      return null;
    },
  });
  if (speedInput === undefined) return;

  // --- Pitch ---
  const pitchInput = await vscode.window.showInputBox({
    title: `Adjust Settings for "${label}" — Step 3/3: Pitch`,
    prompt: "Enter pitch multiplier (0.5 = lower, 1.0 = normal, 2.0 = higher). Requires ffmpeg.",
    value: String(current.pitch),
    validateInput: (v) => {
      const n = parseFloat(v);
      if (isNaN(n) || n < 0.5 || n > 2.0) return "Must be between 0.5 and 2.0";
      return null;
    },
  });
  if (pitchInput === undefined) return;

  await saveSettingsForSound(soundId, {
    volume: parseFloat(volumeInput),
    speed: parseFloat(speedInput),
    pitch: parseFloat(pitchInput),
  });

  vscode.window.showInformationMessage(`Error & Success Reactor: Settings saved for "${label}" — vol: ${volumeInput}, speed: ${speedInput}x, pitch: ${pitchInput}x`);
}

/**
 * Shows an input box for the user to set a custom display label for the
 * currently active sound. Saved to per-sound settings.
 */
async function showCustomLabelEditor() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const soundId = cfg.get("activeSound", "aahh");
  const current = loadSettingsForSound(soundId);

  const newLabel = await vscode.window.showInputBox({
    title: `Edit Label for "${soundId}"`,
    prompt: "Enter a custom display name for this sound (leave empty to use the filename)",
    value: current.customLabel || "",
  });

  if (newLabel === undefined) return;

  await saveSettingsForSound(soundId, { customLabel: newLabel });
  vscode.window.showInformationMessage(
    newLabel.trim() ? `Error & Success Reactor: Label for "${soundId}" set to "${newLabel.trim()}"` : `Error & Success Reactor: Label for "${soundId}" reset to default`,
  );
}

/**
 * Opens a file picker filtered to .mp3 files and copies the selected file
 * into the extension's sounds/errors/ or sounds/success/ folder.
 */
async function showImportSoundFilePicker() {
  // Ask the user which category to import into
  const categoryPick = await vscode.window.showQuickPick(
    [
      { label: "Error Sounds", description: "sounds/errors/", category: "errors" },
      { label: "Success Sounds", description: "sounds/success/", category: "success" },
    ],
    { placeHolder: "Which category should this sound be imported into?", title: "Error & Success Reactor — Import Sound" },
  );
  if (!categoryPick) return;
  const category = categoryPick.category;

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    filters: { "Audio Files": ["mp3"] },
    title: "Error & Success Reactor — Import Sound File",
  });

  if (!selected || selected.length === 0) return;

  const sourcePath = selected[0].fsPath;
  const filename = path.basename(sourcePath);
  const destDir = path.join(extensionCtx.extensionPath, "sounds", category);
  const destPath = path.join(destDir, filename);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    const overwrite = await vscode.window.showWarningMessage(`Error & Success Reactor: "${filename}" already exists in sounds/${category}/. Overwrite?`, { modal: true }, "Overwrite");
    if (overwrite !== "Overwrite") return;
  }

  fs.copyFileSync(sourcePath, destPath);
  invalidateSoundCache();
  const soundId = filename.replace(/\.mp3$/i, "");
  const label = category === "errors" ? "Error" : "Success";
  vscode.window.showInformationMessage(`Error & Success Reactor: "${filename}" imported into ${label} Sounds.`);
}

/**
 * Creates a VS Code WebviewPanel that renders an HTML5 canvas waveform
 * visualiser for the currently active sound using the Web Audio API.
 * The MP3 is encoded as base64 and passed directly into the webview.
 */
function openWaveformViewerPanel() {
  const cfg = vscode.workspace.getConfiguration("errorScreamer");
  const soundId = cfg.get("activeSound", "aahh");
  const soundFilePath = getSoundFilePath("errors", soundId);
  const label = resolveSoundLabel(soundId);

  if (!fs.existsSync(soundFilePath)) {
    vscode.window.showWarningMessage(`Error & Success Reactor: Sound file not found — ${soundFilePath}`);
    return;
  }

  const panel = vscode.window.createWebviewPanel("errorScreamerWaveform", `Error & Success Reactor — ${label} Waveform`, vscode.ViewColumn.One, { enableScripts: true });

  const audioBase64 = fs.readFileSync(soundFilePath).toString("base64");
  panel.webview.html = buildWaveformViewerHtml(label, soundId, audioBase64);
}

/**
 * Generates the full HTML string for the waveform viewer webview.
 * Uses the Web Audio API to decode the MP3 and draw channel data onto a canvas.
 *
 * @param {string} soundLabel    Human-readable name shown in the panel heading
 * @param {string} soundId       Raw sound ID (filename without .mp3)
 * @param {string} audioBase64   Base64-encoded MP3 data
 * @returns {string}
 */
function buildWaveformViewerHtml(soundLabel, soundId, audioBase64) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error & Success Reactor — Waveform Viewer</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: 13px;
            padding: 24px;
        }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .subtitle { opacity: 0.6; margin-bottom: 20px; font-size: 12px; }
        #waveform-canvas {
            display: block;
            width: 100%;
            height: 160px;
            background: var(--vscode-input-background, #2d2d2d);
            border-radius: 6px;
            border: 1px solid var(--vscode-widget-border, #444);
        }
        .controls { margin-top: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        button {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #fff);
            border: none;
            padding: 6px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover { opacity: 0.85; }
        button:disabled { opacity: 0.4; cursor: default; }
        #status { font-size: 12px; opacity: 0.7; margin-top: 6px; }
        .stat-row { margin-top: 16px; display: flex; gap: 24px; flex-wrap: wrap; }
        .stat { background: var(--vscode-input-background, #2d2d2d); padding: 10px 16px; border-radius: 6px; }
        .stat .value { font-size: 18px; font-weight: bold; }
        .stat .key { font-size: 11px; opacity: 0.6; margin-top: 2px; }
    </style>
</head>
<body>
    <h1>🔊 ${soundLabel}</h1>
    <div class="subtitle">Sound ID: ${soundId} &nbsp;|&nbsp; Waveform Viewer</div>

    <canvas id="waveform-canvas"></canvas>
    <div id="status">Decoding audio…</div>

    <div class="controls">
        <button id="btn-play" disabled>▶ Play</button>
        <button id="btn-stop" disabled>■ Stop</button>
    </div>

    <div class="stat-row">
        <div class="stat"><div class="value" id="stat-duration">—</div><div class="key">Duration</div></div>
        <div class="stat"><div class="value" id="stat-channels">—</div><div class="key">Channels</div></div>
        <div class="stat"><div class="value" id="stat-samplerate">—</div><div class="key">Sample Rate</div></div>
        <div class="stat"><div class="value" id="stat-samples">—</div><div class="key">Samples</div></div>
    </div>

    <script>
        const base64Audio = '${audioBase64}';

        function base64ToArrayBuffer(b64) {
            const binary = atob(b64);
            const buf = new ArrayBuffer(binary.length);
            const view = new Uint8Array(buf);
            for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
            return buf;
        }

        const canvas = document.getElementById('waveform-canvas');
        const ctx = canvas.getContext('2d');
        const statusEl = document.getElementById('status');
        const btnPlay = document.getElementById('btn-play');
        const btnStop = document.getElementById('btn-stop');

        let audioCtx, sourceNode, decodedBuffer;

        function drawWaveform(buffer) {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const width = rect.width;
            const height = rect.height;
            const data = buffer.getChannelData(0);
            const step = Math.ceil(data.length / width);
            const mid = height / 2;

            ctx.clearRect(0, 0, width, height);

            // Draw zero-line
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, mid);
            ctx.lineTo(width, mid);
            ctx.stroke();

            // Draw waveform bars
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#e05252');
            gradient.addColorStop(0.5, '#f0a050');
            gradient.addColorStop(1, '#e05252');
            ctx.fillStyle = gradient;

            for (let x = 0; x < width; x++) {
                let min = 1, max = -1;
                for (let s = 0; s < step; s++) {
                    const sample = data[x * step + s] || 0;
                    if (sample < min) min = sample;
                    if (sample > max) max = sample;
                }
                const barHeight = Math.max(1, (max - min) * mid);
                ctx.fillRect(x, mid - barHeight / 2, 1, barHeight);
            }
        }

        async function init() {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const arrayBuffer = base64ToArrayBuffer(base64Audio);
                decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

                drawWaveform(decodedBuffer);

                const dur = decodedBuffer.duration;
                document.getElementById('stat-duration').textContent =
                    dur >= 60 ? (dur / 60).toFixed(2) + ' min' : dur.toFixed(2) + 's';
                document.getElementById('stat-channels').textContent = decodedBuffer.numberOfChannels;
                document.getElementById('stat-samplerate').textContent = decodedBuffer.sampleRate.toLocaleString() + ' Hz';
                document.getElementById('stat-samples').textContent = decodedBuffer.length.toLocaleString();

                statusEl.textContent = 'Ready';
                btnPlay.disabled = false;
            } catch (e) {
                statusEl.textContent = 'Failed to decode audio: ' + e.message;
            }
        }

        btnPlay.addEventListener('click', () => {
            if (!decodedBuffer) return;
            if (sourceNode) { try { sourceNode.stop(); } catch(_) {} }
            sourceNode = audioCtx.createBufferSource();
            sourceNode.buffer = decodedBuffer;
            sourceNode.connect(audioCtx.destination);
            sourceNode.start();
            sourceNode.onended = () => {
                btnPlay.disabled = false;
                btnStop.disabled = true;
                statusEl.textContent = 'Playback complete';
            };
            btnPlay.disabled = true;
            btnStop.disabled = false;
            statusEl.textContent = 'Playing…';
        });

        btnStop.addEventListener('click', () => {
            if (sourceNode) { try { sourceNode.stop(); } catch(_) {} }
            btnPlay.disabled = false;
            btnStop.disabled = true;
            statusEl.textContent = 'Stopped';
        });

        window.addEventListener('resize', () => { if (decodedBuffer) drawWaveform(decodedBuffer); });

        init();
    </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers all 13 extension commands with VS Code.
 * @param {vscode.ExtensionContext} context
 */
function registerAllCommands(context) {
  const commands = [
    [
      "errorScreamer.toggle",
      () => {
        isExtensionEnabled = !isExtensionEnabled;
        vscode.workspace.getConfiguration("errorScreamer").update("enabled", isExtensionEnabled, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Error & Success Reactor: ${isExtensionEnabled ? "Enabled ✔" : "Disabled ✖"}`);
      },
    ],
    [
      "errorScreamer.toggleMute",
      () => {
        isMuted = !isMuted;
        vscode.workspace.getConfiguration("errorScreamer").update("muted", isMuted, vscode.ConfigurationTarget.Global);
        refreshStatusBar();
        vscode.window.showInformationMessage(`Error & Success Reactor: ${isMuted ? "🔇 Muted (tracking still active)" : "🔊 Unmuted"}`);
      },
    ],
    ["errorScreamer.selectErrorSound", showSoundSelectorQuickPick],
    [
      "errorScreamer.testCurrentSound",
      () => {
        playCurrentErrorSound();
        vscode.window.showInformationMessage("Error & Success Reactor: Testing current sound…");
      },
    ],
    ["errorScreamer.adjustCurrentSoundSettings", showSoundSettingsAdjuster],
    [
      "errorScreamer.toggleRandomErrorSound",
      () => {
        const cfg = vscode.workspace.getConfiguration("errorScreamer");
        const current = cfg.get("randomErrorSound", false);
        cfg.update("randomErrorSound", !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Error & Success Reactor: Random error sound ${!current ? "ON 🎲" : "OFF"}`);
      },
    ],
    [
      "errorScreamer.toggleRandomSuccessSound",
      () => {
        const cfg = vscode.workspace.getConfiguration("errorScreamer");
        const current = cfg.get("randomSuccessSound", false);
        cfg.update("randomSuccessSound", !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Error & Success Reactor: Random success sound ${!current ? "ON 🎲" : "OFF"}`);
      },
    ],
    [
      "errorScreamer.toggleReverseModeForCurrentSound",
      async () => {
        const soundId = vscode.workspace.getConfiguration("errorScreamer").get("activeSound", "aahh");
        const current = loadSettingsForSound(soundId);
        await saveSettingsForSound(soundId, { reversePlayback: !current.reversePlayback });
        vscode.window.showInformationMessage(`Error & Success Reactor: Reverse playback for "${resolveSoundLabel(soundId)}" ${!current.reversePlayback ? "ON ⏪" : "OFF"}`);
      },
    ],
    [
      "errorScreamer.toggleCurrentSoundEnabled",
      async () => {
        const soundId = vscode.workspace.getConfiguration("errorScreamer").get("activeSound", "aahh");
        const current = loadSettingsForSound(soundId);
        await saveSettingsForSound(soundId, { enabled: !current.enabled });
        vscode.window.showInformationMessage(`Error & Success Reactor: "${resolveSoundLabel(soundId)}" ${!current.enabled ? "enabled ✔" : "disabled ✖"}`);
      },
    ],
    ["errorScreamer.editCurrentSoundLabel", showCustomLabelEditor],
    ["errorScreamer.importSoundFile", showImportSoundFilePicker],
    ["errorScreamer.openWaveformViewer", openWaveformViewerPanel],
    ["errorScreamer.viewTodayErrorStats", showTodayErrorStats],
    ["errorScreamer.resetLifetimeScreamCount", resetLifetimeScreamCount],
    ["errorScreamer.openSettings", openSettingsPanel],
  ];

  for (const [commandId, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { activate, deactivate };

// Expose internal functions for unit testing when VSCODE_UNIT_TEST=1
if (process.env.VSCODE_UNIT_TEST === "1") {
  module.exports._test = {
    buildDefaultSoundLabel,
    buildChainedAtempoFilters,
    buildFfmpegAudioFilterChain,
    buildWindowsPlaybackCommand,
    buildMacPlaybackCommand,
    buildLinuxPlaybackCommand,
    doesOutputMatchAnyErrorPattern,
    invalidateSoundCache,
    getSoundFilePath,
    discoverSoundsByCategory,
    discoverErrorSounds,
    discoverSuccessSounds,
    FUNNY_TOASTS,
    // Expose state readers for testing
    get soundPlayAvailable() {
      return !!soundPlay;
    },
    get lifetimeScreamCount() {
      return getLifetimeScreamCount();
    },
  };
}
