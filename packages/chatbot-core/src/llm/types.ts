export type Role = "system" | "user" | "assistant";

export type ChatMessage = {
  role: Role;
  content: string;
};

export type StreamOpts = {
  signal: AbortSignal;
};

export interface ChatClient {
  stream(messages: ChatMessage[], opts: StreamOpts): AsyncIterable<string>;
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
