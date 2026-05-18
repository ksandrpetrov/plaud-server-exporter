import assert from "node:assert/strict";
import test from "node:test";

const { resolveAudioMode } = await import("../src/cli/audioMode.js");

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("default audio mode is summary-only when no flags or env", () => {
  withEnv(
    {
      PLAUD_EXPORT_SUMMARY_ONLY: undefined,
      PLAUD_EXPORT_AUDIO: undefined,
    },
    () => {
      const mode = resolveAudioMode({});
      assert.equal(mode.summaryOnly, true);
      assert.equal(mode.includeAudio, false);
    }
  );
});

test("env PLAUD_EXPORT_AUDIO=true opts into audio when summary-only is not forced", () => {
  withEnv(
    {
      PLAUD_EXPORT_SUMMARY_ONLY: "false",
      PLAUD_EXPORT_AUDIO: "true",
    },
    () => {
      const mode = resolveAudioMode({});
      assert.equal(mode.summaryOnly, false);
      assert.equal(mode.includeAudio, true);
      assert.equal(mode.source, "env:audio");
    }
  );
});

test("env PLAUD_EXPORT_SUMMARY_ONLY=true wins over PLAUD_EXPORT_AUDIO=true", () => {
  withEnv(
    {
      PLAUD_EXPORT_SUMMARY_ONLY: "true",
      PLAUD_EXPORT_AUDIO: "true",
    },
    () => {
      const mode = resolveAudioMode({});
      assert.equal(mode.summaryOnly, true);
      assert.equal(mode.includeAudio, false);
      assert.equal(mode.source, "env:summary-only");
    }
  );
});

test("--no-audio overrides env opt-in", () => {
  withEnv(
    {
      PLAUD_EXPORT_SUMMARY_ONLY: "false",
      PLAUD_EXPORT_AUDIO: "true",
    },
    () => {
      const mode = resolveAudioMode({ "no-audio": true });
      assert.equal(mode.summaryOnly, true);
      assert.equal(mode.includeAudio, false);
      assert.equal(mode.source, "cli:no-audio");
    }
  );
});

test("--audio-too overrides env summary-only", () => {
  withEnv(
    {
      PLAUD_EXPORT_SUMMARY_ONLY: "true",
      PLAUD_EXPORT_AUDIO: "false",
    },
    () => {
      const mode = resolveAudioMode({ "audio-too": true });
      assert.equal(mode.summaryOnly, false);
      assert.equal(mode.includeAudio, true);
      assert.equal(mode.source, "cli:audio-too");
    }
  );
});
