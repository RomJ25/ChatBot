// /api/llm/* proxy. Mirrors the Vite dev-server proxy in apps/*/vite.config.ts
// but additionally injects Authorization server-side so the API key stays out
// of the browser bundle.

export type ProxyState = {
  upstream: string;
  apiKey: string;
};

// Headers the browser sends that we must not forward — they either leak the
// request's origin context (which some providers gate on), are hop-by-hop
// (RFC 7230 §6.1 — `connection`, `te`, `trailer`, `transfer-encoding`,
// `upgrade`, `proxy-authorization`, `proxy-authenticate`), or enable request
// smuggling when combined with mismatched framing downstream. Matches the
// Vite dev-server proxy's stripping, extended for production-grade relay.
const DROP_REQUEST_HEADERS = new Set([
  "origin",
  "referer",
  "host",
  "cookie",
  // hop-by-hop
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  // framing / expectations
  "content-length",
  "expect",
  // trust claims the client has no business setting
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "forwarded",
]);

// Stripped from the upstream response: framing/encoding the launcher's own
// HTTP layer re-computes (`content-length`, `content-encoding`), hop-by-hop
// headers (same RFC 7230 list), and auth headers that some upstreams echo
// back in error bodies — `authorization` never leaves the launcher.
const DROP_RESPONSE_HEADERS = new Set([
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

export async function proxyLlm(
  req: Request,
  pathname: string,
  state: ProxyState,
): Promise<Response> {
  const tail = pathname.replace(/^\/api\/llm/, "");
  const base = state.upstream.replace(/\/+$/, "");
  const url = new URL(req.url);
  const upstreamUrl = base + tail + url.search;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  });
  if (state.apiKey) {
    headers.set("authorization", `Bearer ${state.apiKey}`);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      signal: req.signal,
      redirect: "manual",
      // Bun passes ReadableStream bodies through without buffering when
      // duplex: "half" is set. Required for SSE request bodies (rare) and
      // harmless for plain JSON.
      // @ts-expect-error — Bun-specific, not yet in lib.dom
      duplex: "half",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: { message: `upstream fetch failed: ${msg}` } }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) respHeaders.set(k, v);
  });
  // Force SSE-friendly defaults so the browser doesn't buffer. Harmless for
  // plain-JSON responses.
  respHeaders.set("cache-control", "no-cache, no-transform");
  respHeaders.set("x-accel-buffering", "no");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
