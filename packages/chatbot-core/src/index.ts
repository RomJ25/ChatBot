export { default as ChatBot } from "./ChatBot";
export type { ChatBotProps, ChatSuggestion } from "./ChatBot";

export {
  createDefaultClient,
  readConfig,
  OpenAICompatClient,
  LLMError,
} from "./llm";
export type { ChatClient, ChatMessage, LLMConfig, Role } from "./llm";

export type { KnowledgeItem, KnowledgeKind } from "./content/types";
export {
  joinHebrewList,
  renderKnowledgeItem,
  renderKnowledgeBlock,
} from "./content/promptHelpers";
