import { ChatClient, ChatMessage, LLMError, StreamOpts } from "./types";

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
    };
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`;
    if (this.cfg.extraHeaders) Object.assign(h, this.cfg.extraHeaders);
    return h;
  }

  async *stream(
    messages: ChatMessage[],
    { signal }: StreamOpts,
  ): AsyncIterable<string> {
    const payload = {
      model: this.cfg.model,
      stream: true,
      temperature: this.cfg.temperature,
      messages: this.cfg.systemPrompt
        ? [
            { role: "system", content: this.cfg.systemPrompt } as ChatMessage,
            ...messages,
          ]
        : messages,
    };

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
      const snippet = bodyText ? `: ${bodyText.slice(0, 300)}` : "";
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
      // Flush any trailing event without a terminator.
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
    }
  }
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
    const value = line.slice(5).replace(/^\s/, "");
    if (value === "[DONE]") return DONE_SENTINEL;
    dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    const parsed = JSON.parse(payload);
    const delta =
      parsed?.choices?.[0]?.delta?.content ??
      parsed?.choices?.[0]?.message?.content ??
      parsed?.choices?.[0]?.text ??
      "";
    return typeof delta === "string" && delta.length > 0 ? delta : null;
  } catch {
    return null;
  }
}
