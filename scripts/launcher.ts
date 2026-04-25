import path from "node:path";
import EMBEDDED, {
  SLUG,
  HEADLINE,
  ENV_FILENAME,
} from "./launcher/embedded.active";
import { parseEnv, serializeEnv } from "./launcher/env-io";
import { proxyLlm, type ProxyState } from "./launcher/proxy";
import { openBrowser } from "./launcher/open-browser";
import { renderSetupHtml } from "./launcher/setup.html";

// process.execPath and adjacent path APIs return virtual `B:\~BUN\root\...`
// paths inside a Windows compiled Bun binary (oven-sh/bun#16010, #19499) —
// do not use them. process.cwd() is what Bun's own --compile-autoload-dotenv
// uses, and on double-click from Explorer it equals the folder containing
// the .exe. That is where the user-facing `<slug>.env` lives.
const cwd = process.cwd();
const envPath = path.join(cwd, ENV_FILENAME);

// Heuristic: Windows system folders and the drive root are read-only for
// non-admin users (the env-file write will fail), and "anywhere under
// System32" often means the user launched from a Start-menu shortcut whose
// "start in" wasn't set. We can't relocate the file for them, but we can
// flag it loudly in the console.
function looksLikeBadCwd(p: string): string | null {
  const norm = p.replace(/\\/g, "/").toLowerCase();
  if (/\/windows(\/|$)/.test(norm)) return "inside Windows system folder";
  if (/\/program files( \(x86\))?(\/|$)/.test(norm))
    return "inside Program Files (read-only for non-admin)";
  if (/^[a-z]:\/?$/.test(norm)) return "root of a drive";
  return null;
}

type RuntimeState = {
  upstream: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
};

// Upstreams must be http/https. A hand-edited env file or a malicious
// page that bypassed the setup CSRF guard could otherwise plant
// `file:///...` or `data:` and the proxy would obediently fetch local
// files through the chat UI. Keep the check in one place so loadState()
// and handleSetupPost() can't drift.
function isValidUpstream(url: string): boolean {
  return /^https?:\/\/.+/i.test(url);
}

async function loadState(): Promise<RuntimeState> {
  const empty: RuntimeState = {
    upstream: "",
    apiKey: "",
    model: "",
    systemPrompt: "",
  };
  try {
    const file = Bun.file(envPath);
    if (!(await file.exists())) return empty;
    const env = parseEnv(await file.text());
    const upstream = (env.LLM_UPSTREAM ?? "").trim();
    // Silently reject invalid schemes so a poisoned env file forces the
    // user through the setup page instead of reaching the proxy.
    const safeUpstream = isValidUpstream(upstream) ? upstream : "";
    if (upstream && !safeUpstream) {
      console.error(
        `[${SLUG}] ${ENV_FILENAME} has unsafe LLM_UPSTREAM scheme; ignoring`,
      );
    }
    return {
      upstream: safeUpstream,
      apiKey: (env.LLM_API_KEY ?? "").trim(),
      model: (env.LLM_MODEL ?? "").trim(),
      systemPrompt: (env.LLM_SYSTEM_PROMPT ?? "").trim(),
    };
  } catch (err) {
    // Corrupted or unreadable env file shouldn't crash the launcher; just
    // treat it as unconfigured so the user gets the setup page.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${SLUG}] could not read ${ENV_FILENAME}: ${msg}`);
    return empty;
  }
}

let state = await loadState();
const configured = () => Boolean(state.upstream && state.model);

function serveAsset(urlPath: string): Response | null {
  const key = urlPath === "/" ? "/index.html" : urlPath;
  const embedded = EMBEDDED[key];
  if (!embedded) return null;
  // BunFile auto-sets Content-Type from extension (charset included for text
  // types). Just add a cache hint — everything else comes from the BunFile.
  return new Response(Bun.file(embedded), {
    headers: { "cache-control": "no-cache" },
  });
}

function configScript(): Response {
  const cfg = {
    baseUrl: "/api/llm",
    model: state.model,
    apiKey: "", // the launcher proxy injects the real Authorization header
    systemPrompt: state.systemPrompt || undefined,
  };
  const body = `window.__SNIRO_CONFIG__=${JSON.stringify(cfg)};`;
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Is this setup POST from the launcher's own SPA, or from a hostile page that
// found the local port via DNS rebinding / localhost scanning? The SPA always
// runs on http://127.0.0.1:<port> (or http://localhost:<port>), so Origin,
// Host, and Content-Type must all match those expectations. Anything else
// gets a 403 — no CSRF token needed because nothing legitimate should ever
// fail these checks.
function isSameSiteRequest(req: Request, port: number): boolean {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return false;
  // Host: 127.0.0.1:<port> or localhost:<port>. Browsers always send Host,
  // and on a rebinding attack it will be the attacker-controlled hostname,
  // not one of these two.
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  // Origin: browsers always send it on POSTs from fetch/XHR. A missing
  // Origin means the request did not come from a web page — likely a curl
  // or a same-process call — both of which we trust on localhost.
  if (origin !== null) {
    if (
      origin !== `http://127.0.0.1:${port}` &&
      origin !== `http://localhost:${port}`
    ) {
      return false;
    }
  }
  return true;
}

// Serialize setup writes so two rapid clicks can't interleave Bun.write()
// calls and leave a half-written env file.
let setupChain: Promise<void> = Promise.resolve();

async function handleSetupPost(
  req: Request,
  port: number,
): Promise<Response> {
  if (!isSameSiteRequest(req, port)) {
    return Response.json(
      { ok: false, error: "Request blocked (cross-site)" },
      { status: 403 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "גוף הבקשה אינו JSON" }, { status: 400 });
  }
  const upstream = String(body.LLM_UPSTREAM ?? "").trim();
  const model = String(body.LLM_MODEL ?? "").trim();
  const apiKey = String(body.LLM_API_KEY ?? "");
  const systemPrompt = String(body.LLM_SYSTEM_PROMPT ?? "");

  if (!upstream || !isValidUpstream(upstream)) {
    return Response.json(
      { ok: false, error: "כתובת השרת חייבת להיות URL עם http או https" },
      { status: 400 },
    );
  }
  if (!model) {
    return Response.json(
      { ok: false, error: "חובה להזין שם דגם" },
      { status: 400 },
    );
  }

  const next: Record<string, string> = {
    LLM_UPSTREAM: upstream,
    LLM_MODEL: model,
    LLM_API_KEY: apiKey,
  };
  if (systemPrompt.trim()) next.LLM_SYSTEM_PROMPT = systemPrompt;

  // Chain the write so concurrent POSTs can't produce a half-written file.
  let writeErr: unknown = null;
  const thisWrite = setupChain.then(async () => {
    try {
      await Bun.write(
        envPath,
        serializeEnv(
          next,
          `${HEADLINE} — launcher config. Written by first-run setup.\nDelete this file to re-run setup on next launch.`,
        ),
      );
      state = { upstream, apiKey: apiKey.trim(), model, systemPrompt };
    } catch (err) {
      writeErr = err;
    }
  });
  setupChain = thisWrite;
  await thisWrite;
  if (writeErr) {
    // Common cause: exe was dropped in a read-only folder (Program Files,
    // System32) and the user doesn't have write permission here.
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    return Response.json(
      {
        ok: false,
        error: `נכשלה כתיבת ${ENV_FILENAME}: ${msg}. נסה להעביר את קובץ ה-exe לתיקייה עם הרשאת כתיבה (שולחן העבודה או Documents).`,
      },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}

let server: ReturnType<typeof Bun.serve>;
// The port is assigned by Bun.serve on startup (we pass port: 0). Captured in
// a closure below so the setup handler can validate that incoming POSTs
// carry the matching Host / Origin pair.
try {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    // Cap the request body. A setup POST is tiny (< 1 KB); the chat proxy
    // body (messages + attached files) is bounded by the UI's file-read
    // cap of 500 KB per file * ~100 messages — 50 MB is a generous ceiling
    // that prevents a buggy caller from wedging the server with a gigabyte
    // upload.
    maxRequestBodySize: 50 * 1024 * 1024,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname.startsWith("/api/llm")) {
        if (!configured()) {
          return Response.json(
            { error: { message: "launcher not configured" } },
            { status: 503 },
          );
        }
        const proxyState: ProxyState = {
          upstream: state.upstream,
          apiKey: state.apiKey,
        };
        return proxyLlm(req, pathname, proxyState);
      }

      if (pathname === "/__app/config.js") {
        if (!configured()) {
          return new Response(null, {
            status: 302,
            headers: { location: "/__app/setup" },
          });
        }
        return configScript();
      }

      if (pathname === "/__app/setup") {
        if (req.method === "GET") {
          return new Response(renderSetupHtml(HEADLINE), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
        if (req.method === "POST") return handleSetupPost(req, server.port);
        return new Response("Method not allowed", { status: 405 });
      }

      // Unconfigured root → setup page. Once configured, serve the SPA shell.
      if (!configured() && pathname === "/") {
        return new Response(null, {
          status: 302,
          headers: { location: "/__app/setup" },
        });
      }

      const asset = serveAsset(pathname);
      if (asset) return asset;

      // Browsers automatically request /favicon.ico — return no-content instead
      // of a noisy 404. The Vite build already emits its real favicon as part
      // of index.html's <link rel="icon">, which is served via the manifest.
      if (pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      return new Response("Not Found", { status: 404 });
    },
    error(err) {
      // Bun calls this on unhandled errors in fetch(). Swallow so the server
      // stays up; the browser sees a 500.
      console.error(`[${SLUG}] request error: ${err.message}`);
      return new Response("Internal error", { status: 500 });
    },
  });
} catch (err) {
  // Port 0 means "OS picks a free port" — bind failures here are exotic
  // (firewall / sandbox blocking localhost). Print what we can and exit so
  // the console window doesn't vanish before the user sees the message.
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${SLUG}] failed to start local server: ${msg}`);
  console.error(`[${SLUG}] this is usually a firewall or security-policy`);
  console.error(`[${SLUG}] blocking 127.0.0.1 bindings. Try a different folder`);
  console.error(`[${SLUG}] or disable the blocker for this executable.`);
  // Keep the console window open so a double-click user can read the error.
  await new Promise((r) => setTimeout(r, 30000));
  process.exit(1);
}

const url = `http://127.0.0.1:${server.port}`;

// Loud, stable startup banner so a user who launched by double-click can read
// the URL even if the browser didn't auto-open. Plain ASCII only — Windows
// console's default code page (cp1252/cp1255) mangles non-ASCII output, and
// `chcp 65001` isn't guaranteed.
const bar = "=".repeat(56);
console.log(bar);
console.log(`  ${SLUG} launcher`);
console.log(`  open in your browser:  ${url}`);
console.log(`  config file:           ${envPath}`);
if (!configured()) {
  console.log(`  status:                unconfigured — setup page will open`);
} else {
  console.log(`  status:                ready (model=${state.model})`);
}
const cwdWarning = looksLikeBadCwd(cwd);
if (cwdWarning) {
  console.log(`  warning:               working dir ${cwdWarning}`);
  console.log(`                         the config file may fail to save.`);
  console.log(`                         move the .exe to Desktop or Documents.`);
}
console.log(bar);
console.log(`  press Ctrl+C to quit`);
console.log(bar);

openBrowser(url);
