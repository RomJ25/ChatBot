import { OpenAICompatClient } from "./openai-compat";
import type { ChatClient } from "./types";
import { buildSystemPrompt } from "../content/systemPrompt";

export type { ChatClient, ChatMessage, Role } from "./types";
export { LLMError } from "./types";
export { OpenAICompatClient } from "./openai-compat";

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
};

export function readConfig(): LLMConfig | null {
  const baseUrl = (import.meta.env.VITE_LLM_BASE_URL ?? "").trim();
  const apiKey = (import.meta.env.VITE_LLM_API_KEY ?? "").trim();
  const model = (import.meta.env.VITE_LLM_MODEL ?? "").trim();
  const envPrompt = (import.meta.env.VITE_LLM_SYSTEM_PROMPT ?? "").trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    apiKey,
    model,
    // Env prompt wins if set; otherwise the prompt is derived from team.ts.
    systemPrompt: envPrompt || buildSystemPrompt(),
  };
}

export function createDefaultClient(): ChatClient | null {
  const cfg = readConfig();
  if (!cfg) return null;
  return new OpenAICompatClient(cfg);
}
