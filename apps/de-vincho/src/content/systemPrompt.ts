import { joinHebrewList } from "@sniro/chatbot-core";
import type { Persona } from "./persona";
import type { Topic } from "./topics";

/**
 * Build the system prompt for de-vincho. Information-chat shape — NOT team.
 * The model is grounded in `topics` only; it does not pretend to know other
 * subjects.
 */
export function buildSystemPrompt(persona: Persona, topics: Topic[]): string {
  const topicsBlock = topics.length
    ? `## נושאי הידע
${topics.map(topicLine).join("\n")}`
    : "";

  const detailsBlock = topics
    .filter((t) => t.details && t.details.trim())
    .map((t) => `### ${t.title}\n${t.details!.trim()}`)
    .join("\n\n");

  const deepBlock = detailsBlock ? `## פירוט נושאים\n${detailsBlock}` : "";

  const prompt = `אתה ${persona.selfRef}.
${persona.short}

תפקידך לענות על שאלות בנושאים שמפורטים למטה. ענה רק על בסיס המידע שכאן.

## טון
${persona.tone}

${topicsBlock}

${deepBlock}

## כללים
- ענה אך ורק על בסיס המידע שמופיע למעלה. אל תמציא פרטים, שמות או עובדות.
- כשנושא לא מופיע למעלה — אמור "אין לי מידע על כך" והצע למשתמש לבדוק במקור מוסמך.
- תשובות קצרות וממוקדות. הימנע מהקדמות מיותרות.

## פורמט
- **כותרות של נושאים** ב־bold; הסברים — טקסט רגיל.
- רשימות עם תבליטים (\`- \`) כשמופיעים כמה פריטים.
- ללא אימוג'ים, ללא קישוטים.`;

  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

function topicLine(t: Topic): string {
  return `- **${t.title}** — ${t.summary}`;
}

/**
 * Welcome message. If persona.welcome is set, it wins. Otherwise derive a
 * short prose intro based on persona + topic count.
 */
export function buildWelcome(persona: Persona, topics: Topic[]): string {
  if (persona.welcome && persona.welcome.trim()) return persona.welcome;

  const pitch = persona.short.replace(/[.!?]\s*$/u, "");
  const paragraphs: string[] = [];
  paragraphs.push(`שלום! אני **${persona.selfRef}** — ${pitch}.`);

  if (topics.length === 0) {
    paragraphs.push(
      "עוד לא הוזנו נושאים. הוסף רשומות ב־`src/content/topics.ts` ואחזור לחיים.",
    );
  } else {
    const featured = topics.slice(0, 3).map((t) => `**${t.title}**`);
    const featuredStr = joinHebrewList(featured);
    const word = topics.length === 1 ? "נושא" : "נושאים";
    paragraphs.push(
      topics.length > featured.length
        ? `אני יכול לענות על ${topics.length} ${word} — ביניהם ${featuredStr}.`
        : `אני יכול לענות על ${topics.length} ${word}: ${featuredStr}.`,
    );
  }

  paragraphs.push("**במה אפשר לעזור?**");

  return paragraphs.join("\n\n");
}
