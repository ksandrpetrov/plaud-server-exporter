import { createServer } from "node:http";

const SUCCESS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Plaud</title></head>' +
  '<body style="font-family:system-ui;padding:2rem;text-align:center;">' +
  "<h1>Authorization successful!</h1><p>You can close this tab.</p></body></html>";

const NEUTRAL_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Plaud</title></head>' +
  '<body style="font-family:system-ui;padding:2rem;text-align:center;">' +
  "<h1>Continue authorization in the original window.</h1>" +
  "<p>This page can be closed.</p></body></html>";

function errorHtml(message) {
  const escaped = String(message).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
  );
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Plaud</title></head>' +
    '<body style="font-family:system-ui;padding:2rem;text-align:center;">' +
    `<h1>Authorization failed</h1><pre style="white-space:pre-wrap;">${escaped}</pre>` +
    "</body></html>"
  );
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * @param {{
 *   port: number;
 *   expectedState: string;
 *   exchangeCode: (code: string) => Promise<void>;
 *   timeoutMs?: number;
 *   onListening?: () => void;
 *   postSuccessDelayMs?: number;
 * }} opts
 */
export function runOAuthCallback(opts) {
  const {
    port,
    expectedState,
    exchangeCode,
    timeoutMs = 120_000,
    onListening,
    postSuccessDelayMs = 1500,
  } = opts;

  return new Promise((resolve) => {
    let settled = false;
    let exchangeStarted = false;
    let exchangeSucceeded = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let closeTimeoutId = null;

    const server = createServer((req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== "/auth/callback") {
        res.writeHead(404, CORS_HEADERS);
        res.end();
        return;
      }

      const params = reqUrl.searchParams;
      const error = params.get("error");
      const state = params.get("state");
      const code = params.get("code");

      if (error) {
        finish({ status: "denied", error });
        res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "text/html" });
        res.end(errorHtml(error));
        return;
      }

      if (!code) {
        res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "text/html" });
        res.end(NEUTRAL_HTML);
        return;
      }

      if (state !== expectedState) {
        finish({ status: "denied", error: "OAuth state mismatch." });
        res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "text/html" });
        res.end(errorHtml("State mismatch."));
        return;
      }

      if (exchangeStarted) {
        res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "text/html" });
        res.end(exchangeSucceeded ? SUCCESS_HTML : NEUTRAL_HTML);
        return;
      }

      exchangeStarted = true;
      exchangeCode(code)
        .then(() => {
          exchangeSucceeded = true;
          res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "text/html" });
          res.end(SUCCESS_HTML);
          finish({ status: "success" });
        })
        .catch((err) => {
          res.writeHead(500, { ...CORS_HEADERS, "Content-Type": "text/html" });
          res.end(errorHtml(String(err?.message || err)));
          finish({ status: "exchange-failed", error: err });
        });
    });

    server.on("error", (err) => {
      finish({ status: "listen-failed", error: err });
    });

    server.listen(port, "127.0.0.1", () => {
      onListening?.();
    });

    timeoutId = setTimeout(() => {
      finish({ status: "timeout" });
    }, timeoutMs);
    timeoutId.unref?.();

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      const close = () => {
        server.close(() => resolve(result));
      };
      if (result.status !== "success") {
        close();
        return;
      }
      closeTimeoutId = setTimeout(close, postSuccessDelayMs);
      closeTimeoutId.unref?.();
    }
  });
}
