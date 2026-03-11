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
// Summary
// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\n  ${"─".repeat(50)}`);
console.log(`  Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : " ✓"}`);
console.log(`  ${"─".repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
