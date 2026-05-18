import { config } from "../config/config.js";

/**
 * Resolves whether audio should be included for this sync run.
 *
 * Precedence (highest first):
 *   1. `--no-audio` / `--summary-only`         → summary-only, no matter what.
 *   2. `--audio-too`                            → audio enabled.
 *   3. Env `PLAUD_EXPORT_SUMMARY_ONLY=true`     → summary-only.
 *   4. Env `PLAUD_EXPORT_AUDIO=true`            → audio enabled.
 *   5. Default                                  → summary-only.
 *
 * @param {Record<string, boolean | string>} flags
 * @returns {{ summaryOnly: boolean; includeAudio: boolean; source: string }}
 */
export function resolveAudioMode(flags = {}) {
  const cliNoAudio = flags["no-audio"] === true || flags["summary-only"] === true;
  const cliAudioToo = flags["audio-too"] === true;

  if (cliNoAudio) {
    return { summaryOnly: true, includeAudio: false, source: "cli:no-audio" };
  }
  if (cliAudioToo) {
    return { summaryOnly: false, includeAudio: true, source: "cli:audio-too" };
  }

  if (config.exportSummaryOnly === true) {
    return { summaryOnly: true, includeAudio: false, source: "env:summary-only" };
  }
  if (config.exportAudio === true) {
    return { summaryOnly: false, includeAudio: true, source: "env:audio" };
  }
  return { summaryOnly: true, includeAudio: false, source: "default" };
}
