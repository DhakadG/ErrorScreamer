"use strict";
// ---------------------------------------------------------------------------
// Unit tests for Error & Success Reactor — extension.js pure functions
//
// Run:  node test/runTest.js
//   or: npm test
// ---------------------------------------------------------------------------

const assert = require("assert");

// ---------------------------------------------------------------------------
// Inject the vscode mock BEFORE requiring the extension.
// Because `vscode` is not a real npm package here, we hook Module._resolveFilename
// to return a stable key, then pre-populate require.cache with our mock.
// ---------------------------------------------------------------------------
const Module = require("module");
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "vscode") return "vscode"; // Intercept vscode lookups
  return _origResolve.call(this, request, parent, isMain, options);
};
require.cache["vscode"] = {
  id: "vscode",
  filename: "vscode",
  loaded: true,
  parent: null,
  children: [],
  exports: require("./vscode.mock"),
};

// Signal to extension.js that it should expose _test internals
process.env.VSCODE_UNIT_TEST = "1";

// Set a dummy extensionPath so fs.existsSync calls on sounds/ don't throw
process.env.VSCODE_EXTENSION_PATH = __dirname;

const fs = require("fs");
const path = require("path");

const ext = require("../extension");

// Initialize extensionCtx by calling activate with a fake context
const fakeContext = {
  extensionPath: path.resolve(__dirname, ".."),
  globalState: {
    _store: {},
    get(key, defaultValue) {
      return this._store[key] !== undefined ? this._store[key] : defaultValue;
    },
    async update(key, value) {
      this._store[key] = value;
    },
  },
  subscriptions: [],
};
ext.activate(fakeContext);

const t = ext._test;

if (!t) {
  console.error("ERROR: extension._test is not exposed. Make sure VSCODE_UNIT_TEST=1 and the _test export block is present.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let currentSuite = "";

function suite(name) {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`    ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`    ✗  ${name}`);
    const lines = err.message.split("\n");
    lines.forEach((l) => console.error(`       ${l}`));
    failed++;
  }
}

// ---------------------------------------------------------------------------
// soundPlayAvailable (getter)
// ---------------------------------------------------------------------------
suite("soundPlayAvailable");

test("returns a boolean", () => {
  assert.strictEqual(typeof t.soundPlayAvailable, "boolean");
});

// ---------------------------------------------------------------------------
// invalidateSoundCache
// ---------------------------------------------------------------------------
suite("invalidateSoundCache");

test("is a function", () => {
  assert.strictEqual(typeof t.invalidateSoundCache, "function");
});
test("does not throw when called", () => {
  assert.doesNotThrow(() => t.invalidateSoundCache());
});

// ---------------------------------------------------------------------------
// doesOutputMatchAnyErrorPattern
// ---------------------------------------------------------------------------
suite("doesOutputMatchAnyErrorPattern");

test("returns false for empty string", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern(""), false);
});
test("returns false for null", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern(null), false);
});
test("returns false for undefined", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern(undefined), false);
});
test("returns false for whitespace-only string", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern("   \n  "), false);
});
test("matches 'Error:' in output", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern("src/index.js - Error: something broke"), true);
});
test("matches 'Traceback' in output", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern("Traceback (most recent call last):"), true);
});
test("matches 'command not found' in output", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern("bash: foo: command not found"), true);
});
test("returns false for benign output", () => {
  assert.strictEqual(t.doesOutputMatchAnyErrorPattern("Build completed successfully in 2.3s"), false);
});

// ---------------------------------------------------------------------------
// buildDefaultSoundLabel
// ---------------------------------------------------------------------------
suite("buildDefaultSoundLabel");

test("capitalises first character", () => {
  assert.strictEqual(t.buildDefaultSoundLabel("aaahhhhhh"), "Aaahhhhhh");
});
test("capitalises fahhhhh", () => {
  assert.strictEqual(t.buildDefaultSoundLabel("fahhhhh"), "Fahhhhh");
});
test("single character", () => {
  assert.strictEqual(t.buildDefaultSoundLabel("a"), "A");
});
test("already-capitalised string is unchanged", () => {
  assert.strictEqual(t.buildDefaultSoundLabel("Scream"), "Scream");
});
test("underscore names keep underscores", () => {
  assert.strictEqual(t.buildDefaultSoundLabel("my_scream"), "My_scream");
});
test("empty string returns empty string", () => {
  assert.strictEqual(t.buildDefaultSoundLabel(""), "");
});

// ---------------------------------------------------------------------------
// buildChainedAtempoFilters
// ---------------------------------------------------------------------------
suite("buildChainedAtempoFilters");

test("1.0 returns empty array (no filter needed)", () => {
  assert.deepStrictEqual(t.buildChainedAtempoFilters(1.0), []);
});
test("2.0 produces one filter", () => {
  const f = t.buildChainedAtempoFilters(2.0);
  assert.strictEqual(f.length, 1);
  assert.match(f[0], /^atempo=/);
});
test("4.0 requires two chained filters (2×2)", () => {
  const f = t.buildChainedAtempoFilters(4.0);
  assert.strictEqual(f.length, 2, "Need 2 filters for 4x speed");
  assert.strictEqual(f[0], "atempo=2.0");
});
test("0.5 produces one filter", () => {
  const f = t.buildChainedAtempoFilters(0.5);
  assert.strictEqual(f.length, 1);
  assert.match(f[0], /^atempo=/);
});
test("0.25 requires two chained slow-down filters", () => {
  const f = t.buildChainedAtempoFilters(0.25);
  assert.strictEqual(f.length, 2, "Need 2 filters for 0.25x speed");
  assert.strictEqual(f[0], "atempo=0.5");
});
test("all atempo values stay within [0.5, 2.0]", () => {
  const speeds = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];
  for (const speed of speeds) {
    const filters = t.buildChainedAtempoFilters(speed);
    for (const f of filters) {
      const val = parseFloat(f.replace("atempo=", ""));
      assert.ok(val >= 0.5 && val <= 2.0, `atempo=${val} is outside [0.5, 2.0] for speed=${speed}`);
    }
  }
});

// ---------------------------------------------------------------------------
// buildFfmpegAudioFilterChain
// ---------------------------------------------------------------------------
suite("buildFfmpegAudioFilterChain");

test('no processing returns "anull"', () => {
  assert.strictEqual(t.buildFfmpegAudioFilterChain(1.0, 1.0, false), "anull");
});
test('reverse=true puts "areverse" first', () => {
  const chain = t.buildFfmpegAudioFilterChain(1.0, 1.0, true);
  assert.ok(chain.startsWith("areverse"), `Expected "areverse" at start, got: ${chain}`);
});
test("pitch != 1.0 adds asetrate and aresample", () => {
  const chain = t.buildFfmpegAudioFilterChain(1.0, 1.5, false);
  assert.ok(chain.includes("asetrate"), `Missing asetrate in: ${chain}`);
  assert.ok(chain.includes("aresample"), `Missing aresample in: ${chain}`);
});
test("speed != 1.0 adds at least one atempo", () => {
  const chain = t.buildFfmpegAudioFilterChain(2.0, 1.0, false);
  assert.ok(chain.includes("atempo"), `Missing atempo in: ${chain}`);
});
test("reverse + speed both present in chain", () => {
  const chain = t.buildFfmpegAudioFilterChain(2.0, 1.0, true);
  assert.ok(chain.startsWith("areverse"), `Expected "areverse" first: ${chain}`);
  assert.ok(chain.includes("atempo"), `Missing atempo: ${chain}`);
});
test("reverse + pitch both present in chain", () => {
  const chain = t.buildFfmpegAudioFilterChain(1.0, 1.5, true);
  assert.ok(chain.startsWith("areverse"), `Expected "areverse" first: ${chain}`);
  assert.ok(chain.includes("asetrate"), `Missing asetrate: ${chain}`);
});
test("pitch 1.5 uses correct sample-rate multiplier", () => {
  const chain = t.buildFfmpegAudioFilterChain(1.0, 1.5, false);
  assert.ok(chain.includes("44100*1.5"), `Expected 44100*1.5 in: ${chain}`);
});

// ---------------------------------------------------------------------------
// buildWindowsPlaybackCommand
// ---------------------------------------------------------------------------
suite("buildWindowsPlaybackCommand");

test("Add-Type appears BEFORE New-Object (critical ordering bug fix)", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\test.mp3", 0.5, 1.0, 1.0, false);
  const addTypeIdx = cmd.indexOf("Add-Type -AssemblyName PresentationCore");
  const newObjIdx = cmd.indexOf("New-Object System.Windows.Media.MediaPlayer");
  assert.ok(addTypeIdx !== -1, "Command must contain Add-Type");
  assert.ok(newObjIdx !== -1, "Command must contain New-Object MediaPlayer");
  assert.ok(addTypeIdx < newObjIdx, `Add-Type (pos ${addTypeIdx}) must appear before New-Object (pos ${newObjIdx})`);
});
test("volume value is present in simple command", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\test.mp3", 0.7, 1.0, 1.0, false);
  assert.ok(cmd.includes("0.7"), `Volume 0.7 missing from: ${cmd.slice(0, 120)}`);
});
test("simple path uses powershell, not ffmpeg", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\test.mp3", 0.5, 1.0, 1.0, false);
  assert.ok(cmd.toLowerCase().startsWith("powershell"), "Should start with powershell");
  assert.ok(!cmd.includes("ffmpeg"), "Should NOT contain ffmpeg on simple path");
});
test("reverse=true switches to ffmpeg advanced path", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\test.mp3", 0.5, 1.0, 1.0, true);
  assert.ok(cmd.includes("ffmpeg"), "Advanced (reverse) path must use ffmpeg");
});
test("speed != 1.0 switches to ffmpeg advanced path", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\test.mp3", 0.5, 2.0, 1.0, false);
  assert.ok(cmd.includes("ffmpeg"), "Advanced (speed) path must use ffmpeg");
});
test("pitch != 1.0 switches to ffmpeg advanced path", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\test.mp3", 0.5, 1.0, 1.5, false);
  assert.ok(cmd.includes("ffmpeg"), "Advanced (pitch) path must use ffmpeg");
});
test("single quotes in file path are escaped", () => {
  const cmd = t.buildWindowsPlaybackCommand("C:\\sounds\\it's a scream.mp3", 0.5, 1.0, 1.0, false);
  // PS escapes single quotes by doubling them
  assert.ok(cmd.includes("it''s"), `Single quote should be escaped: ${cmd.slice(0, 160)}`);
});

// ---------------------------------------------------------------------------
// buildMacPlaybackCommand
// ---------------------------------------------------------------------------
suite("buildMacPlaybackCommand");

test("simple path uses afplay", () => {
  const cmd = t.buildMacPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, false);
  assert.ok(cmd.startsWith("afplay"), `Expected afplay command, got: ${cmd}`);
});
test("volume is passed with -v flag", () => {
  const cmd = t.buildMacPlaybackCommand("/sounds/test.mp3", 0.8, 1.0, 1.0, false);
  assert.ok(cmd.includes("-v 0.8"), `Expected -v 0.8 in: ${cmd}`);
});
test("speed change triggers ffmpeg pipe to afplay", () => {
  const cmd = t.buildMacPlaybackCommand("/sounds/test.mp3", 0.5, 2.0, 1.0, false);
  assert.ok(cmd.includes("ffmpeg"), `Expected ffmpeg for speed change: ${cmd}`);
  assert.ok(cmd.includes("afplay"), `Advanced path should still pipe to afplay: ${cmd}`);
});
test("reverse triggers ffmpeg pipe", () => {
  const cmd = t.buildMacPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, true);
  assert.ok(cmd.includes("ffmpeg"), `Expected ffmpeg for reverse: ${cmd}`);
});
test("double quotes in path are escaped", () => {
  const cmd = t.buildMacPlaybackCommand('/sounds/my "loud" scream.mp3', 0.5, 1.0, 1.0, false);
  assert.ok(cmd.includes('\\"'), `Double quotes should be escaped in Mac command`);
});

// ---------------------------------------------------------------------------
// buildLinuxPlaybackCommand
// ---------------------------------------------------------------------------
suite("buildLinuxPlaybackCommand");

test("simple path uses ffplay as primary", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, false);
  assert.ok(cmd.includes("ffplay"), `Expected ffplay in: ${cmd}`);
});
test("simple path includes paplay fallback", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, false);
  assert.ok(cmd.includes("paplay"), `Expected paplay fallback in: ${cmd}`);
});
test("simple path includes aplay fallback", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, false);
  assert.ok(cmd.includes("aplay"), `Expected aplay fallback in: ${cmd}`);
});
test("volume 0.5 translates to -volume 50", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, false);
  assert.ok(cmd.includes("-volume 50"), `Expected -volume 50 in: ${cmd}`);
});
test("volume 1.0 translates to -volume 100", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 1.0, 1.0, 1.0, false);
  assert.ok(cmd.includes("-volume 100"), `Expected -volume 100 in: ${cmd}`);
});
test("speed change adds -af filter to ffplay", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 0.5, 2.0, 1.0, false);
  assert.ok(cmd.includes("-af"), `Expected -af for speed: ${cmd}`);
});
test("reverse change adds -af filter to ffplay", () => {
  const cmd = t.buildLinuxPlaybackCommand("/sounds/test.mp3", 0.5, 1.0, 1.0, true);
  assert.ok(cmd.includes("-af"), `Expected -af for reverse: ${cmd}`);
  assert.ok(cmd.includes("areverse"), `Expected areverse in: ${cmd}`);
});

// ---------------------------------------------------------------------------
// FUNNY_TOASTS (v2.0)
// ---------------------------------------------------------------------------
suite("FUNNY_TOASTS");

test("is a non-empty array", () => {
  assert.ok(Array.isArray(t.FUNNY_TOASTS));
  assert.ok(t.FUNNY_TOASTS.length > 0, "FUNNY_TOASTS should have at least 1 message");
});
test("has at least 10 messages for good variety", () => {
  assert.ok(t.FUNNY_TOASTS.length >= 10, `Expected >= 10 toasts, got ${t.FUNNY_TOASTS.length}`);
});
test("all entries are non-empty strings", () => {
  for (const msg of t.FUNNY_TOASTS) {
    assert.strictEqual(typeof msg, "string", `Expected string, got ${typeof msg}`);
    assert.ok(msg.trim().length > 0, "Toast message should not be blank");
  }
});
test("no duplicate messages", () => {
  const unique = new Set(t.FUNNY_TOASTS);
  assert.strictEqual(unique.size, t.FUNNY_TOASTS.length, "Duplicate toast messages found");
});

// ---------------------------------------------------------------------------
// lifetimeScreamCount (v2.0 — getter)
// ---------------------------------------------------------------------------
suite("lifetimeScreamCount");

test("returns a number", () => {
  assert.strictEqual(typeof t.lifetimeScreamCount, "number");
});
test("is non-negative", () => {
  assert.ok(t.lifetimeScreamCount >= 0, `Expected >= 0, got ${t.lifetimeScreamCount}`);
});

// ---------------------------------------------------------------------------
// getSoundFilePath (v2.1 — category-aware)
// ---------------------------------------------------------------------------
suite("getSoundFilePath");

test("is a function", () => {
  assert.strictEqual(typeof t.getSoundFilePath, "function");
});
test("returns path ending with sounds/errors/<id>.mp3 for error category", () => {
  const p = t.getSoundFilePath("errors", "aahh");
  assert.ok(p.includes(path.join("sounds", "errors", "aahh.mp3")), `Expected sounds/errors/aahh.mp3 in: ${p}`);
});
test("returns path ending with sounds/success/<id>.mp3 for success category", () => {
  const p = t.getSoundFilePath("success", "mission-passed");
  assert.ok(p.includes(path.join("sounds", "success", "mission-passed.mp3")), `Expected sounds/success/mission-passed.mp3 in: ${p}`);
});

// ---------------------------------------------------------------------------
// discoverSoundsByCategory (v2.1 — category-aware)
// ---------------------------------------------------------------------------
suite("discoverSoundsByCategory");

test("is a function", () => {
  assert.strictEqual(typeof t.discoverSoundsByCategory, "function");
});
test("returns an array for errors category", () => {
  t.invalidateSoundCache();
  const result = t.discoverSoundsByCategory("errors");
  assert.ok(Array.isArray(result), `Expected array, got ${typeof result}`);
});
test("returns an array for success category", () => {
  t.invalidateSoundCache();
  const result = t.discoverSoundsByCategory("success");
  assert.ok(Array.isArray(result), `Expected array, got ${typeof result}`);
});
test("error sounds have category='errors'", () => {
  t.invalidateSoundCache();
  const result = t.discoverSoundsByCategory("errors");
  for (const s of result) {
    assert.strictEqual(s.category, "errors", `Expected category 'errors', got '${s.category}'`);
  }
});
test("success sounds have category='success'", () => {
  t.invalidateSoundCache();
  const result = t.discoverSoundsByCategory("success");
  for (const s of result) {
    assert.strictEqual(s.category, "success", `Expected category 'success', got '${s.category}'`);
  }
});
test("discoverErrorSounds returns error sounds only", () => {
  t.invalidateSoundCache();
  const result = t.discoverErrorSounds();
  assert.ok(Array.isArray(result));
  for (const s of result) {
    assert.strictEqual(s.category, "errors");
  }
});
test("discoverSuccessSounds returns success sounds only", () => {
  t.invalidateSoundCache();
  const result = t.discoverSuccessSounds();
  assert.ok(Array.isArray(result));
  for (const s of result) {
    assert.strictEqual(s.category, "success");
  }
});
test("discovered sounds have expected properties", () => {
  t.invalidateSoundCache();
  const all = [...t.discoverErrorSounds(), ...t.discoverSuccessSounds()];
  for (const s of all) {
    assert.strictEqual(typeof s.id, "string", "id should be string");
    assert.strictEqual(typeof s.category, "string", "category should be string");
    assert.strictEqual(typeof s.filePath, "string", "filePath should be string");
    assert.strictEqual(typeof s.label, "string", "label should be string");
    assert.strictEqual(typeof s.enabled, "boolean", "enabled should be boolean");
  }
});

// ---------------------------------------------------------------------------
// Sound file discovery (live filesystem)
// ---------------------------------------------------------------------------
suite("Sound file discovery (live)");

test("sounds/errors/ contains at least 1 .mp3 file", () => {
  t.invalidateSoundCache();
  const result = t.discoverErrorSounds();
  assert.ok(result.length >= 1, `Expected at least 1 error sound, got ${result.length}`);
});
test("sounds/success/ contains at least 1 .mp3 file", () => {
  t.invalidateSoundCache();
  const result = t.discoverSuccessSounds();
  assert.ok(result.length >= 1, `Expected at least 1 success sound, got ${result.length}`);
});
test("aahh.mp3 is discoverable as an error sound", () => {
  t.invalidateSoundCache();
  const result = t.discoverErrorSounds();
  const aahh = result.find((s) => s.id === "aahh");
  assert.ok(aahh, "aahh.mp3 should be discoverable in errors category");
});
test("mission-passed.mp3 is discoverable as a success sound", () => {
  t.invalidateSoundCache();
  const result = t.discoverSuccessSounds();
  const mp = result.find((s) => s.id === "mission-passed");
  assert.ok(mp, "mission-passed.mp3 should be discoverable in success category");
});

// ---------------------------------------------------------------------------
// New suites — guard functions, streak, escalation, effective values
// ---------------------------------------------------------------------------

const vscMock = require("./vscode.mock");

// ---------------------------------------------------------------------------
// isDoNotDisturbActive
// ---------------------------------------------------------------------------
suite("isDoNotDisturbActive");

test("returns false when DND is disabled", () => {
  vscMock.__setOverride("doNotDisturbEnabled", false);
  assert.strictEqual(t.isDoNotDisturbActive(), false);
  vscMock.__clearOverrides();
});

test("returns false for malformed startStr", () => {
  vscMock.__setOverride("doNotDisturbEnabled", true);
  vscMock.__setOverride("doNotDisturbStart", "morning");
  vscMock.__setOverride("doNotDisturbEnd", "08:00");
  assert.strictEqual(t.isDoNotDisturbActive(), false);
  vscMock.__clearOverrides();
});

test("returns false for malformed endStr", () => {
  vscMock.__setOverride("doNotDisturbEnabled", true);
  vscMock.__setOverride("doNotDisturbStart", "23:00");
  vscMock.__setOverride("doNotDisturbEnd", "");
  assert.strictEqual(t.isDoNotDisturbActive(), false);
  vscMock.__clearOverrides();
});

test("returns false for hour out of range (25:00)", () => {
  vscMock.__setOverride("doNotDisturbEnabled", true);
  vscMock.__setOverride("doNotDisturbStart", "25:00");
  vscMock.__setOverride("doNotDisturbEnd", "08:00");
  assert.strictEqual(t.isDoNotDisturbActive(), false);
  vscMock.__clearOverrides();
});

test("always-active overnight window (00:01 to 00:00) returns true", () => {
  // Overnight wrap: startMinutes > endMinutes means (now >= start OR now < end)
  // With start=00:01 (1 min) and end=00:00 (0 min): now >= 1 OR now < 0
  // Since now is always >= 1 minute (any real time past midnight), this is always true.
  vscMock.__setOverride("doNotDisturbEnabled", true);
  vscMock.__setOverride("doNotDisturbStart", "00:01");
  vscMock.__setOverride("doNotDisturbEnd", "00:00");
  assert.strictEqual(t.isDoNotDisturbActive(), true);
  vscMock.__clearOverrides();
});

// ---------------------------------------------------------------------------
// isCooldownActive
// ---------------------------------------------------------------------------
suite("isCooldownActive");

test("returns false when no sound has ever played (timestamp=0)", () => {
  t.lastErrorSoundPlayedAt = 0;
  // Date.now() - 0 is very large, well above any cooldown period
  assert.strictEqual(t.isCooldownActive(), false);
});

test("returns true immediately after a sound plays", () => {
  t.lastErrorSoundPlayedAt = Date.now();
  assert.strictEqual(t.isCooldownActive(), true);
});

test("returns false after cooldown period expires", () => {
  // Default cooldown is 3s; set timestamp 10s in the past
  t.lastErrorSoundPlayedAt = Date.now() - 10000;
  assert.strictEqual(t.isCooldownActive(), false);
});

// ---------------------------------------------------------------------------
// isExitCodeIgnored
// ---------------------------------------------------------------------------
suite("isExitCodeIgnored");

test("returns false when ignoredExitCodes is empty", () => {
  vscMock.__setOverride("ignoredExitCodes", []);
  assert.strictEqual(t.isExitCodeIgnored(1), false);
  vscMock.__clearOverrides();
});

test("returns true when exit code is in ignored list", () => {
  vscMock.__setOverride("ignoredExitCodes", [1, 130]);
  assert.strictEqual(t.isExitCodeIgnored(1), true);
  assert.strictEqual(t.isExitCodeIgnored(130), true);
  vscMock.__clearOverrides();
});

test("returns false for non-listed exit code", () => {
  vscMock.__setOverride("ignoredExitCodes", [1, 130]);
  assert.strictEqual(t.isExitCodeIgnored(2), false);
  vscMock.__clearOverrides();
});

// ---------------------------------------------------------------------------
// incrementErrorStreak / resetErrorStreak
// ---------------------------------------------------------------------------
suite("incrementErrorStreak / resetErrorStreak");

test("incrementErrorStreak increases streak by 1", () => {
  t.currentErrorStreak = 0;
  t.incrementErrorStreak();
  assert.strictEqual(t.currentErrorStreak, 1);
});

test("incrementErrorStreak is cumulative across multiple calls", () => {
  t.currentErrorStreak = 0;
  t.incrementErrorStreak();
  t.incrementErrorStreak();
  t.incrementErrorStreak();
  assert.strictEqual(t.currentErrorStreak, 3);
});

test("resetErrorStreak sets streak to 0", () => {
  t.currentErrorStreak = 5;
  t.resetErrorStreak();
  assert.strictEqual(t.currentErrorStreak, 0);
});

// ---------------------------------------------------------------------------
// calculateEscalationTier
// ---------------------------------------------------------------------------
suite("calculateEscalationTier");

test("returns 0 when escalation is disabled", () => {
  vscMock.__setOverride("escalationEnabled", false);
  t.currentErrorStreak = 10;
  assert.strictEqual(t.calculateEscalationTier(), 0);
  vscMock.__clearOverrides();
});

test("returns 0 when streak is below threshold", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  t.currentErrorStreak = 2;
  assert.strictEqual(t.calculateEscalationTier(), 0);
  vscMock.__clearOverrides();
});

test("returns 0 at exactly the threshold", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  t.currentErrorStreak = 3;
  // tier = max(0, 3 - 3) = 0
  assert.strictEqual(t.calculateEscalationTier(), 0);
  vscMock.__clearOverrides();
});

test("returns 1 when one above threshold", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  t.currentErrorStreak = 4;
  assert.strictEqual(t.calculateEscalationTier(), 1);
  vscMock.__clearOverrides();
});

test("returns 5 when five above threshold", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  t.currentErrorStreak = 8;
  assert.strictEqual(t.calculateEscalationTier(), 5);
  vscMock.__clearOverrides();
});

// ---------------------------------------------------------------------------
// getEffectiveVolumeForSound
// ---------------------------------------------------------------------------
suite("getEffectiveVolumeForSound");

test("returns base volume when escalation is disabled", () => {
  vscMock.__setOverride("escalationEnabled", false);
  t.currentErrorStreak = 0;
  const vol = t.getEffectiveVolumeForSound("aahh");
  assert.ok(vol > 0 && vol <= 1.0, `Volume ${vol} should be in (0, 1.0]`);
  vscMock.__clearOverrides();
});

test("adds escalation boost when tier > 0", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  vscMock.__setOverride("escalationVolumeBoost", 0.2);
  t.currentErrorStreak = 4; // tier = 1
  const baseVol = (() => {
    vscMock.__setOverride("escalationEnabled", false);
    const v = t.getEffectiveVolumeForSound("aahh");
    vscMock.__setOverride("escalationEnabled", true);
    return v;
  })();
  const boostedVol = t.getEffectiveVolumeForSound("aahh");
  assert.ok(boostedVol > baseVol, `Boosted volume ${boostedVol} should exceed base ${baseVol}`);
  vscMock.__clearOverrides();
});

test("clamps volume at 1.0 maximum with very high streak", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 1);
  vscMock.__setOverride("escalationVolumeBoost", 0.3);
  t.currentErrorStreak = 100; // tier = 99, boost would far exceed 1.0
  const vol = t.getEffectiveVolumeForSound("aahh");
  assert.strictEqual(vol, 1.0);
  vscMock.__clearOverrides();
});

// ---------------------------------------------------------------------------
// getEffectiveSpeedForSound
// ---------------------------------------------------------------------------
suite("getEffectiveSpeedForSound");

test("returns base speed when escalation is disabled", () => {
  vscMock.__setOverride("escalationEnabled", false);
  t.currentErrorStreak = 0;
  const spd = t.getEffectiveSpeedForSound("aahh");
  assert.ok(spd >= 0.5 && spd <= 4.0, `Speed ${spd} should be in [0.5, 4.0]`);
  vscMock.__clearOverrides();
});

test("adds escalation speed boost when tier > 0", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  vscMock.__setOverride("escalationSpeedBoost", 0.3);
  t.currentErrorStreak = 4; // tier = 1, boost = 0.3
  const spd = t.getEffectiveSpeedForSound("aahh");
  assert.ok(spd > 1.0, `Speed ${spd} should be above default 1.0 when boosted`);
  vscMock.__clearOverrides();
});

test("clamps speed at 4.0 maximum with very high streak", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 1);
  vscMock.__setOverride("escalationSpeedBoost", 1.0);
  t.currentErrorStreak = 100;
  const spd = t.getEffectiveSpeedForSound("aahh");
  assert.strictEqual(spd, 4.0);
  vscMock.__clearOverrides();
});

test("speed result is always >= 0.5", () => {
  vscMock.__setOverride("escalationEnabled", true);
  vscMock.__setOverride("escalationThreshold", 3);
  vscMock.__setOverride("escalationSpeedBoost", 0);
  t.currentErrorStreak = 0;
  const spd = t.getEffectiveSpeedForSound("aahh");
  assert.ok(spd >= 0.5, `Speed ${spd} must be >= 0.5`);
  vscMock.__clearOverrides();
});

// ---------------------------------------------------------------------------
// buildFfmpegAudioFilterChain — clamp edge cases (FIX 8)
// ---------------------------------------------------------------------------
suite("buildFfmpegAudioFilterChain — clamp edge cases");

test("speed 0.1 (below min) is clamped to 0.5 — no throw, returns string", () => {
  const chain = t.buildFfmpegAudioFilterChain(0.1, 1.0, false);
  assert.strictEqual(typeof chain, "string", "Should return a string, not throw");
  assert.ok(chain.includes("atempo"), "Clamped speed 0.5 should still emit atempo");
});

test("speed 10.0 (above max) is clamped to 4.0 — uses chained atempo=2.0", () => {
  const chain = t.buildFfmpegAudioFilterChain(10.0, 1.0, false);
  assert.strictEqual(typeof chain, "string");
  assert.ok(chain.includes("atempo=2.0"), "Max speed 4.0 should chain atempo=2.0 filters");
});

test("pitch 0.1 (below min) is clamped to 0.5 — produces asetrate", () => {
  const chain = t.buildFfmpegAudioFilterChain(1.0, 0.1, false);
  assert.strictEqual(typeof chain, "string");
  assert.ok(chain.includes("asetrate"), "Clamped pitch should still produce asetrate filter");
});

test("pitch 5.0 (above max) is clamped to 2.0 — asetrate uses 2.0000", () => {
  const chain = t.buildFfmpegAudioFilterChain(1.0, 5.0, false);
  assert.strictEqual(typeof chain, "string");
  assert.ok(chain.includes("asetrate=44100*2.0000"), "Clamped pitch at 2.0 should appear in filter");
});

// ---------------------------------------------------------------------------
// buildSettingsPanelHtml — settings panel rendering and CSP
// ---------------------------------------------------------------------------
suite("buildSettingsPanelHtml");

test("is a function", () => {
  assert.strictEqual(typeof t.buildSettingsPanelHtml, "function");
});

test("returns valid HTML string", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.strictEqual(typeof html, "string");
  assert.ok(html.includes("<!DOCTYPE html>"), "Should start with DOCTYPE");
  assert.ok(html.includes("</html>"), "Should end with closing html tag");
});

test("CSP uses nonce for script-src with event delegation (no inline handlers)", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce123");
  assert.ok(html.includes("script-src 'nonce-testnonce123'"), "CSP must use nonce-based script-src");
  assert.ok(html.includes('nonce="testnonce123"'), "Script tag must carry matching nonce attribute");
  // Must NOT have inline event handlers (onclick=, onchange=, oninput=, onkeydown=)
  assert.ok(!html.includes(' onclick='), "Must NOT use inline onclick handlers (blocked by nonce CSP)");
  assert.ok(!html.includes(' onchange='), "Must NOT use inline onchange handlers (blocked by nonce CSP)");
  assert.ok(!html.includes(' oninput='), "Must NOT use inline oninput handlers (blocked by nonce CSP)");
  assert.ok(!html.includes(' onkeydown='), "Must NOT use inline onkeydown handlers (blocked by nonce CSP)");
});

test("CSP allows inline styles", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(html.includes("style-src 'unsafe-inline'"), "CSP should allow inline styles");
});

test("embeds initial state as JSON data block", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(html.includes('id="initial-state"'), "Should embed state in a script tag with id initial-state");
  assert.ok(html.includes('type="application/json"'), "State block should be non-executable JSON type");
});

test("contains acquireVsCodeApi call", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(html.includes("acquireVsCodeApi"), "Should call acquireVsCodeApi for webview messaging");
});

test("contains all major settings sections", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(html.includes("General"), "Should have General section");
  assert.ok(html.includes("Triggers"), "Should have Triggers section");
  assert.ok(html.includes("Sound Library"), "Should have Sound Library section");
  assert.ok(html.includes("Escalation"), "Should have Escalation section");
  assert.ok(html.includes("Do Not Disturb"), "Should have DND section");
  assert.ok(html.includes("Stats"), "Should have Stats section");
});

test("contains data-attribute event delegation controls", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(html.includes('data-g='), "Should have data-g attributes for global settings");
  assert.ok(html.includes('data-action='), "Should have data-action attributes for buttons");
  assert.ok(html.includes('data-toggle='), "Should have data-toggle attributes for collapsible sections");
  assert.ok(html.includes('addEventListener'), "Should use addEventListener for event delegation");
});

test("renders error sound cards when sounds exist", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  // We know aahh.mp3 exists from earlier tests
  assert.ok(html.includes("Aahh") || html.includes("aahh"), "Should render aahh sound card");
});

test("escapes </script> in embedded JSON to prevent premature tag close", () => {
  // Create a state with a string that contains </script>
  const state = t.getFullSettingsState();
  state.globalSettings.activeSound = "test</script><script>alert(1)";
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(!html.includes("</script><script>alert"), "Must escape </script> in embedded JSON");
});

// ---------------------------------------------------------------------------
// getFullSettingsState — settings state serialization
// ---------------------------------------------------------------------------
suite("getFullSettingsState");

test("is a function", () => {
  assert.strictEqual(typeof t.getFullSettingsState, "function");
});

test("returns object with required top-level keys", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  assert.ok(state.globalSettings, "Should have globalSettings");
  assert.ok(Array.isArray(state.errorSounds), "Should have errorSounds array");
  assert.ok(Array.isArray(state.successSounds), "Should have successSounds array");
  assert.ok(Array.isArray(state.sounds), "Should have sounds array");
  assert.ok(state.perSoundSettings, "Should have perSoundSettings object");
  assert.ok(state.stats, "Should have stats object");
});

test("globalSettings contains all expected keys", () => {
  t.invalidateSoundCache();
  const gs = t.getFullSettingsState().globalSettings;
  const expectedKeys = [
    "enabled", "muted", "activeSound", "successSound",
    "randomErrorSound", "randomSuccessSound", "cooldownSeconds",
    "successCooldownSeconds", "showErrorToast", "funnyToasts",
    "playOnDiagnostics", "playOnSave", "playOnTaskFailure",
    "playOnDebuggerCrash", "diagnosticDebounceMs",
    "doNotDisturbEnabled", "doNotDisturbStart", "doNotDisturbEnd",
    "escalationEnabled", "escalationThreshold",
    "escalationVolumeBoost", "escalationSpeedBoost",
    "errorPatternDetectionEnabled", "errorPatterns", "ignoredExitCodes",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in gs, `globalSettings should contain "${key}"`);
  }
});

test("stats object has expected fields", () => {
  t.invalidateSoundCache();
  const stats = t.getFullSettingsState().stats;
  assert.strictEqual(typeof stats.todayCount, "number", "todayCount should be a number");
  assert.strictEqual(typeof stats.currentStreak, "number", "currentStreak should be a number");
  assert.strictEqual(typeof stats.lifetimeScreams, "number", "lifetimeScreams should be a number");
  assert.strictEqual(typeof stats.allStats, "object", "allStats should be an object");
});

test("perSoundSettings has entry for each discovered sound", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  for (const s of state.sounds) {
    assert.ok(s.id in state.perSoundSettings, `perSoundSettings should have entry for "${s.id}"`);
  }
});

test("sound entries have required properties", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  for (const s of state.sounds) {
    assert.strictEqual(typeof s.id, "string", "id should be string");
    assert.strictEqual(typeof s.category, "string", "category should be string");
    assert.strictEqual(typeof s.label, "string", "label should be string");
    assert.strictEqual(typeof s.enabled, "boolean", "enabled should be boolean");
  }
});

// ---------------------------------------------------------------------------
// showErrorToastMessage — toast notification behavior
// ---------------------------------------------------------------------------
suite("showErrorToastMessage");

test("is a function", () => {
  assert.strictEqual(typeof t.showErrorToastMessage, "function");
});

test("does not throw when soundId is undefined", () => {
  const cfg = vscMock.workspace.getConfiguration("errorScreamer");
  assert.doesNotThrow(() => t.showErrorToastMessage(cfg, "exit 1", undefined));
});

test("does not throw when showErrorToast is false", () => {
  vscMock.__setOverride("showErrorToast", false);
  const cfg = vscMock.workspace.getConfiguration("errorScreamer");
  assert.doesNotThrow(() => t.showErrorToastMessage(cfg, "exit 1", "aahh"));
  vscMock.__clearOverrides();
});

test("does not throw when showErrorToast is true and funnyToasts is true", () => {
  vscMock.__setOverride("showErrorToast", true);
  vscMock.__setOverride("funnyToasts", true);
  const cfg = vscMock.workspace.getConfiguration("errorScreamer");
  assert.doesNotThrow(() => t.showErrorToastMessage(cfg, "exit 1", "aahh"));
  vscMock.__clearOverrides();
});

test("does not throw when showErrorToast is true and funnyToasts is false", () => {
  vscMock.__setOverride("showErrorToast", true);
  vscMock.__setOverride("funnyToasts", false);
  const cfg = vscMock.workspace.getConfiguration("errorScreamer");
  assert.doesNotThrow(() => t.showErrorToastMessage(cfg, "exit 1", "aahh"));
  vscMock.__clearOverrides();
});

// ---------------------------------------------------------------------------
// loadSettingsForSound / saveSettingsForSound
// ---------------------------------------------------------------------------
suite("loadSettingsForSound / saveSettingsForSound");

test("loadSettingsForSound returns defaults for unknown sound", () => {
  const settings = t.loadSettingsForSound("nonexistent_sound_xyz");
  assert.strictEqual(settings.volume, 0.5, "Default volume should be 0.5");
  assert.strictEqual(settings.speed, 1.0, "Default speed should be 1.0");
  assert.strictEqual(settings.pitch, 1.0, "Default pitch should be 1.0");
  assert.strictEqual(settings.reversePlayback, false, "Default reversePlayback should be false");
  assert.strictEqual(settings.enabled, true, "Default enabled should be true");
  assert.strictEqual(settings.customLabel, "", "Default customLabel should be empty");
});

test("saveSettingsForSound persists and loadSettingsForSound retrieves", async () => {
  await t.saveSettingsForSound("__test_sound__", { volume: 0.8, speed: 2.0 });
  const loaded = t.loadSettingsForSound("__test_sound__");
  assert.strictEqual(loaded.volume, 0.8, "Saved volume should persist");
  assert.strictEqual(loaded.speed, 2.0, "Saved speed should persist");
  // Non-overridden fields keep defaults
  assert.strictEqual(loaded.pitch, 1.0, "Non-overridden pitch should be default");
});

test("saveSettingsForSound merges partial updates", async () => {
  await t.saveSettingsForSound("__test_merge__", { volume: 0.3, customLabel: "Test" });
  await t.saveSettingsForSound("__test_merge__", { speed: 1.5 });
  const loaded = t.loadSettingsForSound("__test_merge__");
  assert.strictEqual(loaded.volume, 0.3, "Previous volume should persist after partial update");
  assert.strictEqual(loaded.speed, 1.5, "New speed should be saved");
  assert.strictEqual(loaded.customLabel, "Test", "Previous customLabel should persist");
});

// ---------------------------------------------------------------------------
// resolveSoundLabel
// ---------------------------------------------------------------------------
suite("resolveSoundLabel");

test("returns default label when no custom label is set", () => {
  const label = t.resolveSoundLabel("aahh");
  // Should be "Aahh" (capitalized) unless a custom label was set
  assert.strictEqual(typeof label, "string");
  assert.ok(label.length > 0, "Label should not be empty");
});

test("returns custom label when set", async () => {
  await t.saveSettingsForSound("__test_label__", { customLabel: "My Custom Sound" });
  const label = t.resolveSoundLabel("__test_label__");
  assert.strictEqual(label, "My Custom Sound");
});

test("falls back to default label when custom label is whitespace-only", async () => {
  await t.saveSettingsForSound("__test_ws_label__", { customLabel: "   " });
  const label = t.resolveSoundLabel("__test_ws_label__");
  assert.strictEqual(label, "__test_ws_label__".charAt(0).toUpperCase() + "__test_ws_label__".slice(1));
});

// ---------------------------------------------------------------------------
// Settings panel webview — successCooldownSeconds presence
// ---------------------------------------------------------------------------
suite("Settings panel — successCooldownSeconds");

test("getFullSettingsState includes successCooldownSeconds", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  assert.ok("successCooldownSeconds" in state.globalSettings, "globalSettings should include successCooldownSeconds");
  assert.strictEqual(typeof state.globalSettings.successCooldownSeconds, "number");
});

test("settings panel HTML contains success cooldown control", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  assert.ok(html.includes("successCooldownSeconds"), "Webview should have successCooldownSeconds control");
  assert.ok(html.includes("Success Cooldown"), "Webview should label the success cooldown setting");
});

// ---------------------------------------------------------------------------
// Settings panel webview — state round-trip integrity
// ---------------------------------------------------------------------------
suite("Settings panel — state round-trip");

test("embedded state can be parsed back from HTML", () => {
  t.invalidateSoundCache();
  const state = t.getFullSettingsState();
  const html = t.buildSettingsPanelHtml(state, "testnonce");
  // Extract JSON from <script type="application/json" id="initial-state">...</script>
  const match = html.match(/<script type="application\/json" id="initial-state">([\s\S]*?)<\/script>/);
  assert.ok(match, "Should find embedded state JSON in HTML");
  const parsed = JSON.parse(match[1].replace(/<\\\//g, "</"));
  assert.deepStrictEqual(Object.keys(parsed).sort(), Object.keys(state).sort(), "Parsed state keys should match original");
  assert.strictEqual(parsed.globalSettings.enabled, state.globalSettings.enabled, "enabled should round-trip");
  assert.strictEqual(parsed.globalSettings.activeSound, state.globalSettings.activeSound, "activeSound should round-trip");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\n  ${"─".repeat(50)}`);
console.log(`  Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : " ✓"}`);
console.log(`  ${"─".repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
