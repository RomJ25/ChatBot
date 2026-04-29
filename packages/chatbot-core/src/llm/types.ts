export type Role = "system" | "user" | "assistant";

export type ChatMessage = {
  role: Role;
  content: string;
};

export type StreamOpts = {
  signal: AbortSignal;
};

export type CompleteOpts = {
  signal?: AbortSignal;
  /** Max tokens; some providers require this for non-streaming completions. */
  maxTokens?: number;
};

export interface ChatClient {
  stream(messages: ChatMessage[], opts: StreamOpts): AsyncIterable<string>;
  /**
   * Non-streaming completion. Used for background tasks like history
   * summarization where we need the whole reply at once and don't want
   * to feed the live UI.
   */
  complete(messages: ChatMessage[], opts: CompleteOpts): Promise<string>;
}

export type LLMErrorCode =
  | "not_configured"
  | "network"
  | "http"
  | "aborted"
  | "parse";

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly status?: number;
  constructor(message: string, code: LLMErrorCode, status?: number) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.status = status;
  }
}
