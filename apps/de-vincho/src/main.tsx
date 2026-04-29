import React from "react";
import ReactDOM from "react-dom/client";
// Critical weights only — body text. Display fonts (Frank Ruhl, Cormorant)
// and additional weights load after first paint; font-display: swap keeps
// the system Hebrew fallback visible until they resolve.
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/600.css";
import "@sniro/chatbot-core/index.css";
import "./theme.css";
import { ChatBot, type ChatSuggestion } from "@sniro/chatbot-core";
import { PERSONA } from "./content/persona";
import { TOPICS } from "./content/topics";
import { buildSystemPrompt, buildWelcome } from "./content/systemPrompt";

const systemPrompt = buildSystemPrompt(PERSONA, TOPICS);
const welcome = buildWelcome(PERSONA, TOPICS);

const suggestions: ChatSuggestion[] = [
  { label: "מה אתה יודע?", prompt: "אילו נושאים אתה מסביר?" },
  { label: "הסבר מושג", prompt: "הסבר לי מושג מעולם הטכנו" },
  { label: "איפה הידע שלך?", prompt: "מאיפה אתה שולף את התשובות?" },
];

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChatBot
      headline={PERSONA.headline}
      logoUrl="/monogram.svg"
      welcomeHeroUrl="/welcome-portrait.jpg"
      cadence="quill"
      dropCap
      botName="לאונרדו"
      thinkingText="הקולמוס מטבל בדיו…"
      systemPrompt={systemPrompt}
      welcome={welcome}
      suggestions={suggestions}
    />
  </React.StrictMode>,
);

// Defer secondary + display fonts until after first paint.
if (typeof window !== "undefined") {
  const loadDeferred = () => {
    void import("@fontsource/heebo/500.css");
    void import("@fontsource/heebo/700.css");
    void import("@fontsource/frank-ruhl-libre/400.css");
    void import("@fontsource/frank-ruhl-libre/500.css");
    void import("@fontsource/frank-ruhl-libre/700.css");
    void import("@fontsource/cormorant-garamond/400.css");
    void import("@fontsource/cormorant-garamond/600.css");
    void import("@fontsource/cormorant-garamond/400-italic.css");
    void import("@fontsource/cormorant-garamond/600-italic.css");
  };
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(loadDeferred, { timeout: 2000 });
  } else {
    setTimeout(loadDeferred, 0);
  }
}
