import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/600.css";
import "@fontsource/heebo/700.css";
import "@sniro/chatbot-core/index.css";
import "./theme.css";
import { ChatBot, type ChatSuggestion } from "@sniro/chatbot-core";
import { TEAM } from "./content/team";
import { KNOWLEDGE } from "./content/knowledge";
import { buildSystemPrompt, buildWelcome } from "./content/systemPrompt";

const systemPrompt = buildSystemPrompt(TEAM, KNOWLEDGE);
const welcome = buildWelcome(TEAM);

const suggestions: ChatSuggestion[] = [
  { label: "מי מפקד/ת הצוות?", prompt: "מי מפקד/ת הצוות?" },
  { label: "אילו פרויקטים קיימים?", prompt: "אילו פרויקטים קיימים?" },
  { label: "ספר על חברי הצוות", prompt: "ספר על חברי הצוות" },
  { label: "על מה הצוות מתמקד?", prompt: "על מה הצוות מתמקד?" },
];

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChatBot
      headline={`העוזר החכם של ${TEAM.name}`}
      systemPrompt={systemPrompt}
      welcome={welcome}
      suggestions={suggestions}
    />
  </React.StrictMode>,
);
