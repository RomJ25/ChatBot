import { OpenAICompatClient } from "./openai-compat";
import type { ChatClient } from "./types";

export type { ChatClient, ChatMessage, Role } from "./types";
export { LLMError } from "./types";
export { OpenAICompatClient } from "./openai-compat";

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
};

// Runtime config injected by the standalone launcher before the app bundle
// evaluates (see scripts/launcher.ts). Not a module-level import — declared
// globally so it compiles whether or not the app's tsconfig picks up the core
// package's vite-env.d.ts.
declare global {
  interface Window {
    __SNIRO_CONFIG__?: {
      readonly baseUrl?: string;
      readonly apiKey?: string;
      readonly model?: string;
      readonly systemPrompt?: string;
    };
  }
}

/**
 * Read LLM configuration from Vite env vars. The caller owns the system
 * prompt — core makes no assumption about its shape or source.
 *
 * VITE_LLM_SYSTEM_PROMPT (if set) overrides the passed prompt; useful for
 * iterating on prompts without touching code.
 */
export function readConfig(systemPrompt: string): LLMConfig | null {
  // Runtime override: the standalone launcher injects window.__SNIRO_CONFIG__
  // before the app bundle evaluates (classic <script src="/__app/config.js">
  // in index.html, ahead of the module script). It provides baseUrl/model and
  // leaves apiKey empty — the launcher's proxy injects Authorization
  // server-side so the key never reaches the browser.
  const rt =
    typeof window !== "undefined" ? window.__SNIRO_CONFIG__ : undefined;
  const baseUrl = (rt?.baseUrl ?? import.meta.env.VITE_LLM_BASE_URL ?? "").trim();
  const apiKey = (rt?.apiKey ?? import.meta.env.VITE_LLM_API_KEY ?? "").trim();
  const model = (rt?.model ?? import.meta.env.VITE_LLM_MODEL ?? "").trim();
  const envPrompt = (
    rt?.systemPrompt ?? import.meta.env.VITE_LLM_SYSTEM_PROMPT ?? ""
  ).trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    apiKey,
    model,
    systemPrompt: envPrompt || systemPrompt,
  };
}

export function createDefaultClient(systemPrompt: string): ChatClient | null {
  const cfg = readConfig(systemPrompt);
  if (!cfg) return null;
  return new OpenAICompatClient(cfg);
}
