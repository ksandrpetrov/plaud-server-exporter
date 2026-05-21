/**
 * Minimal HTTP server for Docker healthchecks, nginx reverse proxy, and future Web App.
 * Runs alongside the Telegram long-polling loop in the bot process.
 */

import { createServer } from "node:http";
import { config } from "../config/config.js";
import { logger } from "../logger.js";

const CONNECT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Plaud Exporter</title>
</head>
<body>
  <p>Plaud Server Exporter Web App placeholder. Open from Telegram when Web App support is enabled.</p>
</body>
</html>`;

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {string | null}
 */
function readInitData(req) {
  const raw = req.headers["x-telegram-init-data"];
  if (Array.isArray(raw)) return raw[0] || null;
  return raw || null;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function handleRequest(req, res) {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (method === "GET" && path === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (method === "GET" && path === "/connect") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(CONNECT_HTML);
    return;
  }

  if (path.startsWith("/api/")) {
    if (!readInitData(req)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "unauthorized", detail: "Missing X-Telegram-Init-Data" }));
      return;
    }
    if (method === "GET" && path === "/api/v1/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", authenticated: true }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
}

/** @type {import("node:http").Server | null} */
let server = null;

/**
 * @returns {Promise<import("node:http").Server>}
 */
export async function startWebServer() {
  if (server) return server;

  const host = config.webappHost;
  const port = config.webappPort;

  server = createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.once("error", reject);
  });

  const bound = server.address();
  const actualPort =
    bound && typeof bound === "object" && "port" in bound ? bound.port : port;
  logger.info("Web server listening", { host, port: actualPort });
  return server;
}

/**
 * @returns {number | null}
 */
export function getWebServerPort() {
  if (!server) return null;
  const addr = server.address();
  return addr && typeof addr === "object" && "port" in addr ? addr.port : null;
}

/**
 * @returns {Promise<void>}
 */
export async function stopWebServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise((resolve, reject) => {
    s.close((err) => (err ? reject(err) : resolve()));
  });
}
