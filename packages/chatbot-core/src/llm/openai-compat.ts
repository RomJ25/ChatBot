import { ChatClient, ChatMessage, CompleteOpts, LLMError, StreamOpts } from "./types";

export type OpenAICompatConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  extraHeaders?: Record<string, string>;
};

export class OpenAICompatClient implements ChatClient {
  private readonly cfg: OpenAICompatConfig;

  constructor(cfg: OpenAICompatConfig) {
    this.cfg = cfg;
  }

  private endpoint(): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      // Refuse compression on the SSE body. Gzip + chunked streaming lets
      // some intermediate proxies buffer the response until EOF, which
      // defeats the live-token UX. Has no cost for typical short replies.
      "Accept-Encoding": "identity",
    };
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`;
    if (this.cfg.extraHeaders) Object.assign(h, this.cfg.extraHeaders);
    return h;
  }

  async *stream(
    messages: ChatMessage[],
    { signal }: StreamOpts,
  ): AsyncIterable<string> {
    const payload: Record<string, unknown> = {
      model: this.cfg.model,
      stream: true,
      messages: this.cfg.systemPrompt
        ? [
            { role: "system", content: this.cfg.systemPrompt } as ChatMessage,
            ...messages,
          ]
        : messages,
    };
    // Only include temperature when explicitly set — some providers (Ollama,
    // LM Studio) reject `null`/`undefined` for this field.
    if (typeof this.cfg.temperature === "number") {
      payload.temperature = this.cfg.temperature;
    }

    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError")
        throw new LLMError("aborted", "aborted");
      throw new LLMError(
        `שגיאת רשת: ${e?.message ?? "לא ידוע"}`,
        "network",
      );
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const snippet = bodyText ? `: ${scrubSecrets(bodyText).slice(0, 300)}` : "";
      throw new LLMError(
        `HTTP ${res.status} ${res.statusText}${snippet}`,
        "http",
        res.status,
      );
    }

    if (!res.body) {
      throw new LLMError("גוף תשובה ריק מהשרת", "parse");
    }

    const contentType = res.headers.get("content-type") ?? "";
    const isSSE = contentType.includes("text/event-stream");

    if (!isSSE) {
      // Non-streaming fallback: parse full JSON and yield once.
      let text = "";
      try {
        const json = await res.json();
        text =
          json?.choices?.[0]?.message?.content ??
          json?.choices?.[0]?.text ??
          "";
      } catch (e: any) {
        throw new LLMError(
          `תשובת JSON לא תקינה: ${e?.message ?? "לא ידוע"}`,
          "parse",
        );
      }
      if (text) yield text;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx: number;
        while ((sepIdx = indexOfEventSeparator(buffer)) >= 0) {
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + eventSeparatorLength(buffer, sepIdx));
          const delta = parseSSEEvent(rawEvent);
          if (delta === DONE_SENTINEL) return;
          if (delta) yield delta;
        }
      }
      // Flush any multi-byte char that straddled the last chunk, then any
      // trailing event without a terminator.
      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail) {
        const delta = parseSSEEvent(tail);
        if (delta && delta !== DONE_SENTINEL) yield delta;
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      throw new LLMError(
        `שגיאת זרימה: ${e?.message ?? "לא ידוע"}`,
        "network",
      );
    } finally {
      // Release the reader so the underlying stream can be GC'd promptly,
      // especially after an abort. cancel() is a no-op if already closed.
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  async complete(
    messages: ChatMessage[],
    { signal, maxTokens }: CompleteOpts,
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: this.cfg.model,
      stream: false,
      messages: this.cfg.systemPrompt
        ? [
            { role: "system", content: this.cfg.systemPrompt } as ChatMessage,
            ...messages,
          ]
        : messages,
    };
    if (typeof this.cfg.temperature === "number") {
      payload.temperature = this.cfg.temperature;
    }
    if (typeof maxTokens === "number") payload.max_tokens = maxTokens;

    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError")
        throw new LLMError("aborted", "aborted");
      throw new LLMError(
        `שגיאת רשת: ${e?.message ?? "לא ידוע"}`,
        "network",
      );
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const snippet = bodyText ? `: ${scrubSecrets(bodyText).slice(0, 300)}` : "";
      throw new LLMError(
        `HTTP ${res.status} ${res.statusText}${snippet}`,
        "http",
        res.status,
      );
    }

    let json: any;
    try {
      json = await res.json();
    } catch (e: any) {
      throw new LLMError(
        `תשובת JSON לא תקינה: ${e?.message ?? "לא ידוע"}`,
        "parse",
      );
    }
    const raw =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      "";
    return coerceContent(raw);
  }
}

// Redact bearer tokens if a misbehaving server echoes the Authorization
// header back in an error body. Defense in depth — keys should not reach
// logs or error bubbles.
function scrubSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/(authorization["'\s:]+)[^"'\n,]+/gi, "$1[redacted]")
    .replace(/(api[-_]?key["'\s:]+)[^"'\n,]+/gi, "$1[redacted]");
}

const DONE_SENTINEL = Symbol("done") as unknown as string;

// SSE events end with \n\n (LF-LF) or \r\n\r\n (CRLF-CRLF).
function indexOfEventSeparator(buf: string): number {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function eventSeparatorLength(buf: string, idx: number): number {
  return buf.startsWith("\r\n\r\n", idx) ? 4 : 2;
}

function parseSSEEvent(rawEvent: string): string | null {
  // An event may consist of multiple `data:` lines which concatenate.
  const dataLines: string[] = [];
  for (const line of rawEvent.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    // Strip the leading single space after `:` per SSE spec, then strip any
    // stray CR if the server used `\r\n\n` separators — keeps the [DONE]
    // sentinel matchable and JSON.parse fed clean input.
    const value = line.slice(5).replace(/^\s/, "").replace(/\r$/, "");
    if (value === "[DONE]") return DONE_SENTINEL;
    dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    const parsed = JSON.parse(payload);
    const raw =
      parsed?.choices?.[0]?.delta?.content ??
      parsed?.choices?.[0]?.message?.content ??
      parsed?.choices?.[0]?.text ??
      "";
    const text = coerceContent(raw);
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// Accept both strings and the array form some compat endpoints emit, e.g.
// [{type: "text", text: "..."}].
function coerceContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    let out = "";
    for (const part of raw) {
      if (typeof part === "string") {
        out += part;
      } else if (part && typeof part === "object") {
        const p = part as { text?: unknown; content?: unknown };
        if (typeof p.text === "string") out += p.text;
        else if (typeof p.content === "string") out += p.content;
      }
    }
    return out;
  }
  return "";
}
