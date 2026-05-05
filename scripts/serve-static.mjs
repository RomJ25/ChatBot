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
const env = parseEnv(
  fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "",
);

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
          message: `LLM_UPSTREAM not configured in apps/${slug}/.env.local`,
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
  const bodyChunks = [];
  for await (const c of req) bodyChunks.push(c);
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
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const resolved = path.normalize(path.join(base, decoded));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
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
  fs.stat(file, (err, stat) => {
    // SPA fallback: if the path doesn't exist or names a directory, serve
    // index.html so client-side routing still works. Matches Vite preview.
    if (err || stat.isDirectory()) {
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
  if (req.url && req.url.startsWith("/api/llm")) {
    handleProxy(req, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(err) } }));
      }
    });
    return;
  }
  serveStatic(req, res);
});

// 127.0.0.1 only — no LAN exposure. Matches the launcher's bind.
server.listen(port, "127.0.0.1", () => {
  console.log(`[safe] ${slug} → http://127.0.0.1:${port}/`);
  if (!proxyEnabled) {
    console.log(
      `[safe] WARNING: LLM_UPSTREAM not set in apps/${slug}/.env.local — chat will return 502s.`,
    );
  } else {
    console.log(`[safe] proxy: /api/llm → ${upstream}`);
  }
});
