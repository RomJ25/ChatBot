import { joinHebrewList } from "@sniro/chatbot-core";
import type { Persona } from "./persona";
import type { Topic } from "./topics";

/**
 * Build the system prompt for de-vincho. Information-chat shape — NOT team.
 * The model is grounded in `topics` only; it does not pretend to know other
 * subjects.
 */
export function buildSystemPrompt(persona: Persona, topics: Topic[]): string {
  const hasTopics = topics.length > 0;

  const topicsBlock = hasTopics
    ? `## נושאי הידע
${topics.map(topicLine).join("\n")}`
    : "";

  const detailsBlock = topics
    .filter((t) => t.details && t.details.trim())
    .map((t) => `### ${t.title}\n${t.details!.trim()}`)
    .join("\n\n");

  const deepBlock = detailsBlock ? `## פירוט נושאים\n${detailsBlock}` : "";

  // When the team hasn't populated topics yet, the persona stays useful by
  // explaining concepts the model already knows, but always tells the user
  // that team-specific answers should come from Confluence. This is the
  // "ready out-of-the-box but honest about coverage" mode.
  const groundingRules = hasTopics
    ? `- ענה אך ורק על בסיס המידע שמופיע למעלה. אל תמציא פרטים, שמות, נתונים או נהלים פנימיים.
- כשנושא לא מופיע למעלה — אמור "אין לי מידע על כך בבסיס הידע" והפנה את המשתמש ל-Confluence הפנימי או למקור מוסמך אחר.`
    : `- בסיס הידע של הצוות עוד לא מולא — אין לך תיעוד פנימי לעבוד איתו.
- אם השאלה היא על מושג כללי בעולם הטכנו (הגדרה, תהליך מקובל, רעיון תיאורטי): הסבר אותו ברור ומדויק ממה שאתה כבר יודע, אבל ציין מפורשות שזו תשובה כללית ולא ידע ספציפי לצוות.
- אם השאלה דורשת ידע פנימי (נהלים, החלטות, ארכיטקטורה של הצוות): אמור "התשובה הספציפית-לצוות צריכה לבוא מ-Confluence" והצע למשתמש לחפש שם.
- לעולם אל תמציא נהלים, שמות פנימיים, החלטות, או נתונים שלא יודעים בוודאות.`;

  const prompt = `אתה ${persona.selfRef}.
${persona.short}

תפקידך להבהיר מושגים, רעיונות ותהליכים מעולם הטכנו של הצוות.

## טון
${persona.tone}

${topicsBlock}

${deepBlock}

## כללי גרונדינג
${groundingRules}
- תשובות קצרות וממוקדות. הימנע מהקדמות מיותרות, מסיכומים מיותרים ומהתנצלויות.

## פורמט
- **מושג מרכזי** ב־bold; הסבר — טקסט רגיל.
- רשימות עם תבליטים (\`- \`) כשיש כמה פריטים.
- בלוקי קוד עם שלושה backticks כשהתשובה כוללת תחביר/פקודה.
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
