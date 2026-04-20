import { TEAM, type Project, type TeamContent, type TeamMember } from "./team";
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
 * Rules at the bottom tell the model to stay within these facts.
 */
export function buildSystemPrompt(
  team: TeamContent = TEAM,
  knowledge: KnowledgeItem[] = KNOWLEDGE,
): string {
  const about = team.about ? team.about.trim() : "";

  const commanderBlock = team.commander
    ? `## מפקד/ת הצוות
${memberLine(team.commander)}`
    : "";

  const membersBlock = team.members.length
    ? `## חברי/ות הצוות
${team.members.map(memberLine).join("\n")}`
    : "";

  const projectsBlock = team.projects.length
    ? `## פרויקטים קיימים
${team.projects.map(projectLine).join("\n")}`
    : "";

  const knowledgeBlock = buildKnowledgeBlock(knowledge);

  const prompt = `אתה העוזר החכם של **${team.name}**.
${team.short}

תפקידך לעזור למשתמשים להכיר את הצוות ואת העשייה שלו: חברים, תחומי אחריות, פרויקטים, תהליכים ומושגים. התבסס אך ורק על העובדות שמפורטות למטה.

${about}

## טון ושפה
- קול: ${team.tone.voice}
- קהל יעד: ${team.tone.audience}
- שפה: ענה תמיד ב${team.tone.language}, גם כאשר השאלה בשפה אחרת.
- אורך: תשובות קצרות וממוקדות. משפט אחד לעובדה פשוטה, רשימה למספר פריטים. הימנע מהקדמות מיותרות.

${commanderBlock}

${membersBlock}

${projectsBlock}

${knowledgeBlock}

## כללים
- ענה אך ורק על בסיס המידע שמופיע למעלה. אל תמציא שמות, תפקידים, פרויקטים, מולקולות או עובדות.
- כשחסר מידע — אמור זאת ישירות ("אין לי מידע על כך") והצע למי אפשר לפנות (המפקד/ת או חבר/ת הצוות הרלוונטי/ת, לפי הנושא).
- כשאתה מצטט פריט ידע, ציין את הכותרת שלו ב**הדגשה**.
- השתמש ב-Markdown: הדגשות, רשימות ו-\`code\` כשרלוונטי.`;

  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

function memberLine(m: TeamMember): string {
  // Only name:              "- **name**"
  // Only role:              "- **name** — role"              (e.g. commander)
  // Only responsibility:    "- **name** — responsibility"    (typical member)
  // Both:                   "- **name** (role) — responsibility"
  if (m.role && m.responsibility) {
    return `- **${m.name}** (${m.role}) — ${m.responsibility}`;
  }
  const detail = m.responsibility ?? m.role;
  return detail ? `- **${m.name}** — ${detail}` : `- **${m.name}**`;
}

function projectLine(p: Project): string {
  const base = p.description
    ? `- **${p.name}** — ${p.description}`
    : `- **${p.name}**`;
  return p.status ? `${base} _(סטטוס: ${p.status})_` : base;
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
  return `שלום! אני העוזר החכם של **${team.name}**. אפשר לשאול אותי על חברי הצוות, הפרויקטים, ועל העשייה שלנו. **במה אפשר לעזור?**`;
}
