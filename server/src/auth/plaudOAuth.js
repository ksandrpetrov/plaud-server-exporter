/**
 * Plaud OAuth (PKCE) — aligned with @plaud-ai/cli shared/oauth.js.
 * Stores tokens in server/.data/oauth-tokens.json (chmod 600 via atomic write).
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { runOAuthCallback } from "./oauthCallbackServer.js";
import {
  describeOAuthTokens,
  loadOAuthTokens,
  removeOAuthTokens,
  saveOAuthTokens,
} from "./oauthTokenStore.js";

const execFileAsync = promisify(execFile);

const OFFICIAL_API_BASE = "https://platform.plaud.ai/developer/api";

function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState() {
  return randomBytes(16).toString("base64url");
}

function oauthConfig() {
  return {
    clientId: config.plaudOAuthClientId,
    clientSecret: config.plaudOAuthClientSecret,
    redirectUri: config.plaudOAuthRedirectUri,
    authorizationUrl: config.plaudOAuthAuthorizationUrl,
    tokenUrl: config.plaudOAuthTokenUrl,
    refreshUrl: config.plaudOAuthRefreshUrl,
    apiBase: config.plaudOfficialApiBase,
    extraHeaders: config.plaudOAuthExtraHeaders,
  };
}

/**
 * @param {{
 *   access_token: string;
 *   refresh_token?: string;
 *   token_type?: string;
 *   expires_at?: number;
 *   expires_in?: number;
 * }} data
 * @returns {import("./oauthTokenStore.js").OAuthTokenSet}
 */
function normalizeTokenResponse(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type ?? "Bearer",
    expires_at: data.expires_in
      ? Date.now() + Number(data.expires_in) * 1000
      : data.expires_at,
  };
}

export function createAuthorizationRequest() {
  const cfg = oauthConfig();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return {
    url: `${cfg.authorizationUrl}?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * @param {string} code
 * @param {string} codeVerifier
 * @param {string} state
 */
export async function exchangeOAuthCode(code, codeVerifier, state) {
  const cfg = oauthConfig();
  const basicAuth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    "base64"
  );
  const body = {
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
    state,
  };
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
      ...cfg.extraHeaders,
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const tokenSet = normalizeTokenResponse(data);
  await saveOAuthTokens(tokenSet);
  return tokenSet;
}

/**
 * @param {string} refreshToken
 */
export async function refreshOAuthTokens(refreshToken) {
  const cfg = oauthConfig();
  const res = await fetch(cfg.refreshUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...cfg.extraHeaders,
    },
    body: new URLSearchParams({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const tokenSet = normalizeTokenResponse({
    ...data,
    refresh_token: data.refresh_token ?? refreshToken,
  });
  await saveOAuthTokens(tokenSet);
  return tokenSet;
}

/**
 * @returns {Promise<string | null>}
 */
export async function getOAuthAccessToken() {
  const tokenSet = await loadOAuthTokens();
  if (!tokenSet?.access_token) return null;

  if (tokenSet.expires_at && Date.now() > tokenSet.expires_at - 60_000) {
    if (tokenSet.refresh_token) {
      try {
        const refreshed = await refreshOAuthTokens(tokenSet.refresh_token);
        return refreshed.access_token;
      } catch (error) {
        logger.warn("plaudOAuth: token refresh failed", {
          error: String(error?.message || error),
        });
        return null;
      }
    }
    return null;
  }
  return tokenSet.access_token;
}

export async function revokeOAuthSession() {
  const token = await getOAuthAccessToken();
  if (token) {
    const cfg = oauthConfig();
    try {
      await fetch(`${cfg.apiBase}/open/third-party/users/current/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...cfg.extraHeaders,
        },
      });
    } catch {
      // Best-effort revoke.
    }
  }
  await removeOAuthTokens();
}

/**
 * @returns {Promise<import("./plaudSessionExtractor.js").PlaudSession | null>}
 */
export async function createSessionFromOAuth() {
  const accessToken = await getOAuthAccessToken();
  if (!accessToken) return null;
  const cfg = oauthConfig();
  return {
    apiBase: cfg.apiBase || OFFICIAL_API_BASE,
    authHeader: `Bearer ${accessToken}`,
    userAuthHeader: `Bearer ${accessToken}`,
    workspaceAuthHeader: "",
    workspaceId: "",
    sortBy: "start_time",
    userId: "",
    authMode: "oauth",
    apiMode: "official",
  };
}

export { describeOAuthTokens };

async function probeCallbackPort(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", (err) => resolve(err));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(null));
    });
  });
}

async function openBrowser(url) {
  if (process.env.PLAUD_OAUTH_NO_BROWSER === "1") {
    logger.info("Open this URL in your browser to sign in:", { url });
    return;
  }
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await execFileAsync("open", [url]);
    } else if (platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url]);
    } else {
      await execFileAsync("xdg-open", [url]);
    }
  } catch {
    logger.info(
      "Could not open browser automatically. Open this URL manually:",
      {
        url,
      }
    );
  }
}

/**
 * Interactive OAuth login (browser + localhost callback).
 */
export async function runInteractiveOAuthLogin() {
  const port = config.plaudOAuthCallbackPort;
  const existing = await getOAuthAccessToken();
  if (existing) {
    try {
      const cfg = oauthConfig();
      const res = await fetch(`${cfg.apiBase}/open/third-party/users/current`, {
        headers: {
          Authorization: `Bearer ${existing}`,
          Accept: "application/json",
          ...cfg.extraHeaders,
        },
      });
      if (res.ok) {
        logger.info(
          "Already logged in via OAuth. Run logout first to switch accounts."
        );
        return;
      }
    } catch {
      // Continue with fresh login.
    }
    await removeOAuthTokens();
  }

  const portError = await probeCallbackPort(port);
  if (portError?.code === "EADDRINUSE") {
    throw new Error(
      `OAuth callback port ${port} is already in use. Stop the other process or set PLAUD_OAUTH_CALLBACK_PORT.`
    );
  }
  if (portError) {
    throw new Error(
      `Could not bind OAuth callback port ${port}: ${portError.message}`
    );
  }

  const { url, codeVerifier, state } = createAuthorizationRequest();
  logger.info("Waiting for browser authentication…");

  const result = await runOAuthCallback({
    port,
    expectedState: state,
    timeoutMs: config.plaudOAuthLoginTimeoutMs,
    exchangeCode: async (code) => {
      await exchangeOAuthCode(code, codeVerifier, state);
    },
    onListening: () => {
      logger.info("Opening browser for Plaud OAuth…");
      openBrowser(url).catch(() => {});
    },
  });

  switch (result.status) {
    case "success":
      logger.info("OAuth login successful.");
      return;
    case "timeout":
      throw new Error("OAuth authentication timed out after 2 minutes.");
    case "denied":
      throw new Error(
        `OAuth authentication was denied: ${result.error || "unknown"}`
      );
    case "exchange-failed":
      throw new Error(
        `OAuth token exchange failed: ${result.error?.message || result.error}`
      );
    case "listen-failed":
      throw new Error(
        `OAuth callback server failed: ${result.error?.message || result.error}`
      );
    default:
      throw new Error("OAuth login failed.");
  }
}

/**
 * @returns {Promise<number>}
 */
export async function validateOAuthSession(session) {
  const cfg = oauthConfig();
  const res = await fetch(
    `${session.apiBase}/open/third-party/files/?page=1&page_size=1`,
    {
      headers: {
        Authorization: session.authHeader,
        Accept: "application/json",
        ...cfg.extraHeaders,
      },
    }
  );
  if (res.status === 401 || res.status === 403) {
    const { PlaudAuthError } = await import("../plaud/errors.js");
    throw new PlaudAuthError(
      `Plaud OAuth token rejected (HTTP ${res.status}).`,
      res.status
    );
  }
  if (!res.ok) {
    throw new Error(`Plaud official API HTTP ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.data) ? payload.data.length : 0;
}
