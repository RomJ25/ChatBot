import React from "react";
import ReactDOM from "react-dom/client";
// Critical weights only: 400 for paragraph text, 700 for bold/headlines.
// Other weights load after first paint to avoid blocking the initial render.
import "@fontsource/heebo/400.css";
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
      logoUrl="/owl-mark.svg"
      welcomeHeroUrl="/welcome-crest.jpg"
      botName={TEAM.name}
      thinkingText="מחפש בידע…"
      systemPrompt={systemPrompt}
      welcome={welcome}
      suggestions={suggestions}
    />
  </React.StrictMode>,
);

// Defer secondary weights until after first paint. font-display: swap
// (shipped by @fontsource) keeps text visible against system fallback while
// these resolve.
if (typeof window !== "undefined") {
  const loadDeferred = () => {
    void import("@fontsource/heebo/500.css");
    void import("@fontsource/heebo/600.css");
  };
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(loadDeferred, { timeout: 2000 });
  } else {
    setTimeout(loadDeferred, 0);
  }
}
