import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { isLocalStorageSessionReady } from "./plaudSessionExtractor.js";
import { ensureSecureDir, saveSessionSnapshot } from "./sessionStore.js";

const REQUIRED_LOCALSTORAGE_PREFIXES = [
  "pld_",
  "plaud_user_api_domain",
  "tokenstr",
];

// A realistic UA matching a recent stable Chrome on macOS/Linux. Playwright's
// bundled Chromium advertises `HeadlessChrome` / older Chromium versions which
// Google's anti-automation heuristics use as one of several block signals.
const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Removes the obvious `navigator.webdriver === true` signal that Google checks
// during sign-in. We also pass --disable-blink-features=AutomationControlled so
// the property is never installed; this script is a belt-and-suspenders guard
// for any context where Chrome already attached the property.
const STEALTH_INIT_SCRIPT = `
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (_) { /* ignore */ }
`;

function shouldKeepKey(key) {
  if (!key) return false;
  if (REQUIRED_LOCALSTORAGE_PREFIXES.some((p) => key.startsWith(p)))
    return true;
  if (key.includes(":currentWorkspaceId")) return true;
  if (key.includes(":workspaceList")) return true;
  if (key.includes(":sort_by")) return true;
  if (key.includes("plaud_user_api_domain")) return true;
  return false;
}

/**
 * Returns the launch options used for both interactive and headless flows.
 *
 * Defaults to the installed Google Chrome (`channel: "chrome"`) because
 * Google's "this browser may not be secure" page blocks sign-in from
 * Playwright's bundled Chromium. Users can override via env:
 *   PLAUD_PLAYWRIGHT_CHANNEL=chromium     # force the bundled build
 *   PLAUD_PLAYWRIGHT_CHANNEL=msedge       # or any Playwright channel
 *   PLAUD_PLAYWRIGHT_EXECUTABLE=/path/to/Google\ Chrome
 */
function browserLaunchOptions({ headless }) {
  const explicitChannel = (process.env.PLAUD_PLAYWRIGHT_CHANNEL || "").trim();
  const executablePath = (process.env.PLAUD_PLAYWRIGHT_EXECUTABLE || "").trim();

  /** @type {Record<string, unknown>} */
  const opts = {
    headless,
    viewport: { width: 1280, height: 800 },
    userAgent: REALISTIC_USER_AGENT,
    // Drop the automation banner + the `--enable-automation` switch that adds
    // the `navigator.webdriver` getter and trips Google's heuristics.
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
    ],
  };

  if (executablePath) {
    opts.executablePath = executablePath;
  } else if (explicitChannel) {
    if (explicitChannel !== "chromium") {
      opts.channel = explicitChannel;
    }
  } else {
    // Default: use the installed Google Chrome. This is what Google treats as
    // a "secure" browser. If Chrome is not installed locally, the launch will
    // fail with a clear message and the user can fall back to chromium via
    // PLAUD_PLAYWRIGHT_CHANNEL=chromium.
    opts.channel = "chrome";
  }

  return opts;
}

async function applyStealth(context) {
  try {
    await context.addInitScript(STEALTH_INIT_SCRIPT);
  } catch (err) {
    logger.warn("Failed to install stealth init script; continuing.", {
      message: String(err?.message || err),
    });
  }
}

/**
 * Interactive login needs a desktop Chrome on your Mac. VPS images have no
 * display and Google blocks headless Chromium sign-in.
 */
function assertInteractiveAuthEnvironment() {
  const onLinux = process.platform === "linux";
  const hasDisplay = Boolean(
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY
  );
  const deployRoot = String(process.env.PLAUD_DEPLOY_ROOT || "").trim();
  const cwdLooksLikeVps =
    process.cwd().startsWith("/opt/plaud-server-exporter") ||
    process.cwd().startsWith("/srv/plaud-exporter");

  if (onLinux && !hasDisplay && (cwdLooksLikeVps || deployRoot)) {
    throw new Error(
      "server:auth must run on your Mac (or another machine with Google Chrome and a display), " +
        "not on the VPS. On Mac: npm run server:auth, then npm run server:push-session. " +
        "See docs/getting-started.md → «Сессия с Mac»."
    );
  }
}

function explainLaunchFailure(error) {
  const message = String(error?.message || error);
  const onHeadlessLinux =
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY;

  if (
    /Chromium distribution 'chrome' is not found/i.test(message) ||
    /Executable doesn't exist/i.test(message)
  ) {
    if (onHeadlessLinux) {
      return (
        "Google Chrome is not available on this Linux host (typical for a VPS). " +
        "Do not run server:auth on the server — run it on your Mac, then deploy the session: " +
        "npm run server:push-session (or scp server/.data/session.json to the server). " +
        "Playwright auth on the VPS is unsupported (no display; Google blocks headless sign-in)."
      );
    }
    return (
      "Google Chrome was not found locally. Install Chrome from " +
      "https://www.google.com/chrome/ (recommended — Google blocks sign-in " +
      "from Playwright's bundled Chromium) or set " +
      "PLAUD_PLAYWRIGHT_CHANNEL=chromium to fall back to the bundled build."
    );
  }
  return null;
}

/**
 * Runs an interactive login: opens Chromium with a persistent profile, waits
 * for the user to sign into Plaud Web, then extracts a session snapshot.
 *
 * @param {{ headless?: boolean; loginTimeoutMs?: number }} [options]
 */
export async function runInteractiveLogin(options = {}) {
  assertInteractiveAuthEnvironment();
  const { chromium } = await import("playwright");
  const headless = options.headless ?? false;
  const loginTimeoutMs = options.loginTimeoutMs ?? 10 * 60 * 1000;

  await ensureSecureDir(config.playwrightProfileDir);

  const launchOptions = browserLaunchOptions({ headless });
  logger.info("Launching browser with persistent profile.", {
    profileDir: config.playwrightProfileDir,
    headless,
    channel: launchOptions.channel || "chromium-bundled",
    executablePath: launchOptions.executablePath || null,
  });

  let context;
  try {
    context = await chromium.launchPersistentContext(
      config.playwrightProfileDir,
      launchOptions
    );
  } catch (error) {
    const hint = explainLaunchFailure(error);
    if (hint) {
      logger.error(hint);
    }
    throw error;
  }
  await applyStealth(context);

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(config.plaudWebOrigin, { waitUntil: "domcontentloaded" });

    logger.info(
      "Please complete the Plaud Web login in the opened browser window. " +
        "This CLI will detect the session automatically. If Google blocks " +
        'the sign-in with "this browser may not be secure", sign into ' +
        "Plaud with your email/password (not Google), or follow " +
        "docs/troubleshooting.md → «Google блокирует вход»."
    );

    const deadline = Date.now() + loginTimeoutMs;
    /** @type {Record<string, string>} */
    let snapshotKeys = {};
    let loggedWaitingForWorkspace = false;

    while (Date.now() < deadline) {
      try {
        snapshotKeys = await page.evaluate(() => {
          /** @type {Record<string, string>} */
          const out = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            out[k] = localStorage.getItem(k) || "";
          }
          return out;
        });
      } catch (err) {
        logger.warn("localStorage read failed; retrying.", {
          message: String(err?.message || err),
        });
      }

      const readiness = isLocalStorageSessionReady(snapshotKeys);
      if (readiness.ready) break;

      const hasToken = !!(
        snapshotKeys["pld_tokenstr"] || snapshotKeys["tokenstr"]
      );
      if (hasToken && !loggedWaitingForWorkspace) {
        loggedWaitingForWorkspace = true;
        logger.info(
          "Login token detected; waiting for Plaud to finish loading your workspace " +
            "(keep the browser open until your recordings list appears)."
        );
        try {
          await page.waitForLoadState("networkidle", { timeout: 45_000 });
        } catch {
          // SPA may never reach networkidle; we still poll localStorage below.
        }
      }

      await page.waitForTimeout(2000);
    }

    const finalReadiness = isLocalStorageSessionReady(snapshotKeys);
    if (!finalReadiness.ready) {
      if (!(snapshotKeys["pld_tokenstr"] || snapshotKeys["tokenstr"])) {
        throw new Error(
          "Did not detect a Plaud session within the login window. Aborting."
        );
      }
      throw new Error(
        "Plaud login token was saved but workspace session keys never appeared. " +
          "Stay signed in at web.plaud.ai until your recordings list loads, then run " +
          "`npm run server:auth` again. Missing keys: " +
          finalReadiness.missing.join(", ")
      );
    }

    const filteredLocalStorage = Object.fromEntries(
      Object.entries(snapshotKeys).filter(([k]) => shouldKeepKey(k))
    );
    const cookies = await context.cookies();
    const plaudCookies = cookies
      .filter((c) => /plaud\.ai$/.test(c.domain || ""))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
      }));

    const snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      localStorage: filteredLocalStorage,
      cookies: plaudCookies,
    };

    await saveSessionSnapshot(snapshot);

    const tokenKeyCount = Object.keys(filteredLocalStorage).length;
    logger.info("Plaud session captured.", {
      sessionPath: config.sessionPath,
      localStorageKeyCount: tokenKeyCount,
      cookieCount: plaudCookies.length,
    });

    return snapshot;
  } finally {
    await context.close().catch(() => {});
  }
}
