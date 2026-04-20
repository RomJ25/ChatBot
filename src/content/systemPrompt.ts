import { TEAM, type Project, type TeamContent } from "./team";
import {
  KNOWLEDGE,
  type KnowledgeItem,
  type KnowledgeKind,
} from "./knowledge";

/**
 * Derive a grounded Hebrew system prompt from the canonical content.
 *
 * Consumes two sources:
 *   1) team.ts — typed domain data (members, commander, projects)
 *   2) knowledge.ts — free-form knowledge items (FAQs, glossary, processes,
 *      links, notes). Hand-authored OR pulled from external sources.
 *
 * Whenever either changes, the LLM's grounding automatically updates.
 * Hard rules at the bottom tell the model to stay within these facts.
 */
export function buildSystemPrompt(
  team: TeamContent = TEAM,
  knowledge: KnowledgeItem[] = KNOWLEDGE,
): string {
  const about = team.about ? team.about.trim() : "";

  const commanderBlock = team.commander
    ? `## מפקד/ת הצוות
- **${team.commander.name}** — ${team.commander.role ?? team.commander.responsibility}`
    : "";

  const membersBlock = team.members.length
    ? `## חברי/ות הצוות
${team.members
  .map(
    (m) =>
      `- **${m.name}**${m.role ? ` (${m.role})` : ""} — ${m.responsibility}`,
  )
  .join("\n")}`
    : "";

  const projectsBlock = team.projects.length
    ? `## פרויקטים קיימים
${team.projects.map(projectLine).join("\n")}`
    : "";

  const knowledgeBlock = buildKnowledgeBlock(knowledge);

  const prompt = `אתה העוזר החכם של **${team.name}**.
${team.short}

${about}

## טון ושפה
- קול: ${team.tone.voice}
- קהל יעד: ${team.tone.audience}
- שפה: ${team.tone.language}

${commanderBlock}

${membersBlock}

${projectsBlock}

${knowledgeBlock}

## כללים קשיחים
- ענה **רק** על בסיס המידע שמופיע למעלה.
- אם אין לך תשובה לשאלה — אמור זאת בכנות ("אין לי מידע על כך") במקום להמציא.
- אל תמציא שמות, תפקידים, פרויקטים, מולקולות או עובדות שלא מופיעים כאן.
- כשאתה מתייחס לפריט ידע ספציפי, תוכל לציין את הכותרת שלו בהדגשה.
- השתמש ב-Markdown לעיצוב: **הדגשות**, רשימות, כותרות ו-\`code\` כשרלוונטי.
- שמור על טון אחיד כפי שמוגדר למעלה.`;

  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

function projectLine(p: Project): string {
  const extras = [
    p.status ? `סטטוס: ${p.status}` : "",
    typeof p.progress === "number" ? `התקדמות: ${p.progress}%` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const base = p.description
    ? `- **${p.name}** — ${p.description}`
    : `- **${p.name}**`;
  return extras ? `${base} _(${extras})_` : base;
}

/**
 * Render knowledge items grouped by kind, each under a Hebrew header.
 * Empty kinds are omitted; if nothing is present, returns "".
 */
function buildKnowledgeBlock(items: KnowledgeItem[]): string {
  if (!items.length) return "";

  // Stable presentation order by kind, with Hebrew headings.
  const groups: { kind: KnowledgeKind; heading: string }[] = [
    { kind: "glossary", heading: "## מושגים" },
    { kind: "process", heading: "## תהליכים" },
    { kind: "faq", heading: "## שאלות נפוצות" },
    { kind: "link", heading: "## קישורים" },
    { kind: "note", heading: "## הערות" },
  ];

  const sections: string[] = [];
  for (const { kind, heading } of groups) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (!ofKind.length) continue;
    const lines = ofKind.map(renderItem).join("\n");
    sections.push(`${heading}\n${lines}`);
  }

  return sections.join("\n\n");
}

function renderItem(item: KnowledgeItem): string {
  // Inline short single-line bodies; indent multi-line bodies under the title.
  const body = item.body.trim();
  const isOneLine = !body.includes("\n") && body.length < 120;
  if (isOneLine) {
    return `- **${item.title}** — ${body}`;
  }
  const indented = body
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
  return `- **${item.title}**\n${indented}`;
}

/** Welcome message shown on first load. Overridable via `TEAM.welcome`. */
export function buildWelcome(team: TeamContent = TEAM): string {
  if (team.welcome && team.welcome.trim()) return team.welcome;
  return `שלום. אני העוזר החכם של **${team.name}**. אפשר לשאול אותי על חברי הצוות, הפרויקטים, או כל דבר אחר. **במה אפשר לעזור?**`;
}
