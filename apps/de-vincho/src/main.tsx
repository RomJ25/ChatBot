import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/600.css";
import "@fontsource/heebo/700.css";
import "@fontsource/frank-ruhl-libre/400.css";
import "@fontsource/frank-ruhl-libre/500.css";
import "@fontsource/frank-ruhl-libre/700.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource/cormorant-garamond/600-italic.css";
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
