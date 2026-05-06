#!/usr/bin/env node
// scripts/serve-static.mjs — scan-safe production server.
//
// Why this exists:
//   The .exe path (scripts/bundle.ts → out/<slug>.exe) ships an unsigned
//   Bun-compiled single-file binary. Corporate AV/EDR (Defender for Endpoint,
//   CrowdStrike, SentinelOne) routinely flag unsigned executables with an
//   embedded language runtime, regardless of what the code actually does.
//   This script is plain Node 20+. The only executable that runs on the
//   target machine is node.exe — signed by the OpenJS Foundation. No
//   bundled runtime, no compilation step, no Bun, no Vite at runtime.
//
//   Behavior mirrors scripts/launcher/proxy.ts: drops Origin/Referer/Cookie
//   and hop-by-hop headers, injects Authorization server-side from env
//   (key never reaches the browser), 120s headers timeout, SSE-friendly
//   response (no buffering, no transform), 502 on upstream failure.
//
// Usage: node scripts/serve-static.mjs <sniro|de-vincho>
//
// Reads apps/<slug>/.env.local for VITE_PORT, LLM_UPSTREAM, VITE_LLM_API_KEY.
// LLM_UPSTREAM is server-only and never inlined into the browser bundle.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const VALID = new Set(["sniro", "de-vincho"]);
const slug = process.argv[2];
if (!slug || !VALID.has(slug)) {
  console.error(`usage: node scripts/serve-static.mjs <${[...VALID].join("|")}>`);
  process.exit(1);
}

const distDir = path.join(repoRoot, "apps", slug, "dist");
if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error(
    `error: ${distDir}/index.html not found.\n` +
      `Run \`node scripts/safe-build.mjs ${slug}\` first.`,
  );
  process.exit(1);
}

const envPath = path.join(repoRoot, "apps", slug, ".env.local");
const env = parseEnv(readEnvFile(envPath));

const defaultPort = slug === "de-vincho" ? 5174 : 5173;
const port = parseInt(env.VITE_PORT || String(defaultPort), 10);

const upstream = (env.LLM_UPSTREAM || "").replace(/\/+$/, "");
const apiKey = env.VITE_LLM_API_KEY || env.LLM_API_KEY || "";
const proxyEnabled = !!upstream;

// Header drop sets mirror scripts/launcher/proxy.ts. Origin/Referer/Cookie
// are stripped because some upstreams gate on them; the rest are hop-by-hop
// (RFC 7230 §6.1) or trust-claim headers the browser must not be able to set.
const DROP_REQ = new Set([
  "origin",
  "referer",
  "host",
  "cookie",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "content-length",
  "expect",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "forwarded",
]);
const DROP_RES = new Set([
  "content-length",
  "content-encoding",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "authorization",
  "proxy-authorization",
  "proxy-authenticate",
]);

const HEADERS_TIMEOUT_MS = 120_000;
// Chat-completion request bodies are JSON, never large. Cap at 2 MiB so a
// runaway client (or a misbehaving SDK) can't OOM the Node process by
// streaming gigabytes through the loopback proxy.
const MAX_PROXY_BODY = 2 * 1024 * 1024;
// Method allow-lists. /api/llm needs POST for completions, GET for some
// providers' /models discovery, OPTIONS only for same-origin preflight,
// HEAD for liveness. Static is read-only — GET/HEAD only.
const PROXY_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);
const STATIC_METHODS = new Set(["GET", "HEAD"]);

// Strict CSP — Vite production build emits no inline scripts, so 'self' is
// enough for script-src. Inline styles are needed because React renders
// `style="..."` attrs and some component libs inject `<style>` tags.
// connect-src 'self' confines fetch/XHR/EventSource to same-origin, which
// covers /api/llm. Locking base-uri, frame-ancestors, form-action prevents
// clickjacking and base-tag rebasing if a markdown-rendered link ever leaks.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; img-src 'self' data:; font-src 'self' data:; " +
    "base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function readEnvFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (err) {
    // ENOENT is fine — running pre-bootstrap is supported (server starts in
    // "configuration required" state). Other errors (EACCES, EISDIR, weird
    // encoding throws on read) get a single-line warning so the operator
    // notices, but the server still starts so they can fix the file.
    if (err && err.code !== "ENOENT") {
      console.error(
        `[safe] WARNING: cannot read ${p}: ${err.code || err.message} — ` +
          `continuing with no env (proxy disabled, default port).`,
      );
    }
    return "";
  }
}

function parseEnv(text) {
  const out = {};
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function handleProxy(req, res) {
  if (!proxyEnabled) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: `LLM_UPSTREAM not configured in ${envPath}`,
        },
      }),
    );
    return;
  }

  const tail = req.url.replace(/^\/api\/llm/, "");
  const upstreamUrl = upstream + tail;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (DROP_REQ.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) headers[k] = v.join(", ");
    else if (v != null) headers[k] = v;
  }
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
  // Defense-in-depth against intermediate buffering of SSE.
  headers["accept-encoding"] = "identity";
  headers["x-accel-buffering"] = "no";

  // Buffer the request body — chat completions are JSON, never large. Avoids
  // the duplex-stream juggling that web-streams-as-fetch-body needs in Node.
  // Hard-capped at MAX_PROXY_BODY so a runaway client can't OOM us.
  let total = 0;
  const bodyChunks = [];
  try {
    for await (const c of req) {
      total += c.length;
      if (total > MAX_PROXY_BODY) {
        if (!res.headersSent) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "request body too large" },
            }),
          );
        }
        req.destroy();
        return;
      }
      bodyChunks.push(c);
    }
  } catch {
    // Client disconnected mid-upload, or stream error. Nothing to send back.
    return;
  }
  const body = bodyChunks.length ? Buffer.concat(bodyChunks) : undefined;

  // Compose two abort sources: (1) the headers timer (cleared once response
  // headers arrive) and (2) client disconnect (active for the streaming body).
  const composite = new AbortController();
  const onClose = () => composite.abort();
  req.on("close", onClose);
  const timer = setTimeout(() => composite.abort(), HEADERS_TIMEOUT_MS);

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
      signal: composite.signal,
      redirect: "manual",
    });
    clearTimeout(timer);
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = composite.signal.aborted && !req.destroyed;
    const detail = timedOut
      ? `upstream did not send response headers within ${Math.round(HEADERS_TIMEOUT_MS / 1000)}s`
      : `upstream fetch failed: ${msg}`;
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: detail } }));
    }
    return;
  }

  const respHeaders = {};
  upstreamRes.headers.forEach((v, k) => {
    if (!DROP_RES.has(k.toLowerCase())) respHeaders[k] = v;
  });
  respHeaders["cache-control"] = "no-cache, no-transform";
  respHeaders["x-accel-buffering"] = "no";

  res.writeHead(upstreamRes.status, respHeaders);
  if (upstreamRes.body) {
    Readable.fromWeb(upstreamRes.body).pipe(res);
  } else {
    res.end();
  }
}

function safeJoin(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    // Malformed percent-encoding (e.g. lone `%`) — refuse rather than guess.
    return null;
  }
  // Block null bytes (path-truncation tricks against C-string-using libs),
  // backslashes (never legal in URL paths; on Windows path.normalize would
  // treat them as separators and could escape the prefix check), and Windows
  // drive letters (a request like `/C:/Windows/...` after decode could
  // resolve to an absolute path on a Windows host).
  if (decoded.includes("\u0000")) return null;
  if (decoded.includes("\\")) return null;
  if (/^\/?[a-zA-Z]:/.test(decoded)) return null;

  const resolved = path.normalize(path.join(base, decoded));
  const baseSep = base + path.sep;
  // Windows path comparisons are case-insensitive; a request with a
  // different-case prefix (e.g. `c:\users\...`) must still be checked.
  if (process.platform === "win32") {
    const r = resolved.toLowerCase();
    const b = base.toLowerCase();
    const bs = baseSep.toLowerCase();
    if (r !== b && !r.startsWith(bs)) return null;
  } else if (resolved !== base && !resolved.startsWith(baseSep)) {
    return null;
  }
  return resolved;
}

function serveStatic(req, res) {
  let urlPath = req.url || "/";
  if (urlPath === "/") urlPath = "/index.html";
  let file = safeJoin(distDir, urlPath);
  if (!file) {
    res.writeHead(403);
    res.end();
    return;
  }
  // lstat (not stat) so symlinks don't get followed. If `dist/` ever ends
  // up containing a symlink — accidentally or maliciously — we don't want
  // to serve whatever it points to outside the tree. Treat directories,
  // missing files, and symlinks as the SPA fallback to index.html.
  fs.lstat(file, (err, stat) => {
    if (err || stat.isDirectory() || stat.isSymbolicLink()) {
      file = path.join(distDir, "index.html");
    }
    fs.readFile(file, (err2, buf) => {
      if (err2) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(buf);
    });
  });
}

const server = http.createServer((req, res) => {
  // Security headers go on EVERY response (success, 4xx, 5xx). Setting them
  // up front means the writeHead calls below don't need to repeat them.
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  const method = (req.method || "").toUpperCase();
  const url = req.url || "/";

  if (url.startsWith("/api/llm")) {
    if (!PROXY_METHODS.has(method)) {
      res.writeHead(405, {
        "content-type": "application/json",
        allow: "GET, HEAD, POST, OPTIONS",
      });
      res.end(JSON.stringify({ error: { message: "method not allowed" } }));
      return;
    }
    if (method === "OPTIONS") {
      // Same-origin app — no CORS preflight is needed. Reply 204 with the
      // allow header so a curious client doesn't get a misleading error.
      res.writeHead(204, { allow: "GET, HEAD, POST, OPTIONS" });
      res.end();
      return;
    }
    handleProxy(req, res).catch((err) => {
      // Log the real error server-side; respond with a generic message so
      // we don't leak filesystem paths or library internals across the wire.
      console.error("[safe] proxy error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "internal error" } }));
      }
    });
    return;
  }

  if (!STATIC_METHODS.has(method)) {
    res.writeHead(405, { "content-type": "text/plain", allow: "GET, HEAD" });
    res.end("method not allowed");
    return;
  }

  serveStatic(req, res);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[safe] port ${port} already in use. ` +
        `Set VITE_PORT in ${envPath} to a free port.`,
    );
  } else {
    console.error(`[safe] server error: ${err.code || err.message}`);
  }
  process.exit(1);
});

// Graceful shutdown: stop accepting new connections, then exit. The 2s
// fallback timer covers the case where a long-running SSE stream is still
// open — in that case we let the user re-take the port instead of waiting.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

// 127.0.0.1 only — no LAN exposure. Matches the launcher's bind.
server.listen(port, "127.0.0.1", () => {
  console.log(`[safe] ${slug} → http://127.0.0.1:${port}/`);
  if (!proxyEnabled) {
    console.log(
      `[safe] WARNING: LLM_UPSTREAM not set in ${envPath} — chat will return 502s.`,
    );
  } else {
    console.log(`[safe] proxy: /api/llm → ${upstream}`);
  }
});
