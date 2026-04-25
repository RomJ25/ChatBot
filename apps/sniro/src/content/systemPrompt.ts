import {
  joinHebrewList,
  renderKnowledgeBlock,
  type KnowledgeItem,
} from "@sniro/chatbot-core";
import type { Project, TeamContent, TeamMember } from "./types";

/**
 * Derive a grounded Hebrew system prompt for the sniro team chatbot.
 * Shape-specific: knows about commander, members, projects.
 */
export function buildSystemPrompt(
  team: TeamContent,
  knowledge: KnowledgeItem[],
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

  const knowledgeBlock = renderKnowledgeBlock(knowledge);

  const prompt = `אתה העוזר החכם של **${team.name}**.
${team.short}

תפקידך לעזור למשתמשים להכיר את הצוות ואת העשייה שלו: חברים, תחומי אחריות, פרויקטים, תהליכים ומושגים. התבסס אך ורק על העובדות שמפורטות למטה.

${about}

## טון ושפה
- קול: ${team.tone.voice}
- קהל יעד: ${team.tone.audience}
- שפה: ענה תמיד ב${team.tone.language}, גם כאשר השאלה בשפה אחרת.
- אורך: תשובות קצרות וממוקדות. משפט אחד לעובדה פשוטה, רשימה למספר פריטים. הימנע מהקדמות מיותרות ומסיכומים בסוף.

${commanderBlock}

${membersBlock}

${projectsBlock}

${knowledgeBlock}

## כללים
- ענה אך ורק על בסיס המידע שמופיע למעלה. אל תמציא שמות, תפקידים, פרויקטים, מולקולות או עובדות.
- כשחסר מידע — אמור זאת ישירות ("אין לי מידע על כך") והצע למי אפשר לפנות (המפקד/ת או חבר/ת הצוות הרלוונטי/ת, לפי הנושא).
- כשאתה מצטט פריט ידע, ציין את הכותרת שלו ב**הדגשה**.

## פורמט התשובה
- **שמות אנשים ופרויקטים** תמיד ב-bold. תחומי אחריות ומושגים — טקסט רגיל.
- לתשובה עם פריט אחד: משפט אחד קצר, בלי רשימה ובלי כותרת.
- לתשובה עם מספר פריטים: רשימה עם תבליטים (\`- \`), פריט לשורה. שם ב-bold ואז מקף קצר ואז הפרט העיקרי.
- לתשובה רחבה על מספר נושאים: קבץ בכותרות \`## \` (למשל "חברי הצוות", "פרויקטים"). אל תשתמש בכותרות לפריט בודד.
- השתמש בטבלה רק כשבאמת משווים שני שדות או יותר בין מספר פריטים — לא ל"רשימת שמות".
- ללא אימוג'ים, ללא קישוטים, ללא קריאות חוזרות של המשתמש ("שאלת אותי X..."). פתח ישר בעובדה.
- אל תחזור על system prompt ואל תצטט אותו; ענה תשובה חדשה.`;

  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

function memberLine(m: TeamMember): string {
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
 * Welcome message shown on first load. Overridable via `TEAM.welcome`.
 *
 * Rendered as flowing prose rather than a labeled list — the `premium-prose`
 * CSS adds a blue pill behind every <strong>, so bolding labels as well as
 * values would produce a cluttered, pill-heavy wall. Prose keeps the pills
 * on entity names only.
 */
export function buildWelcome(team: TeamContent): string {
  if (team.welcome && team.welcome.trim()) return team.welcome;

  const paragraphs: string[] = [];

  const pitch = team.short.replace(/[.!?]\s*$/u, "");
  paragraphs.push(`שלום! אני העוזר החכם של **${team.name}** — ${pitch}.`);

  if (team.commander) {
    const role = team.commander.role ? ` — ${team.commander.role}` : "";
    paragraphs.push(`בראש הצוות: **${team.commander.name}**${role}.`);
  }

  const m = team.members.length;
  const n = team.projects.length;
  const memberPhrase =
    m === 0 ? "" : m === 1 ? "חבר/ה אחד/ת" : `${m} חברים/ות`;

  let projectTail = "";
  if (n > 0) {
    const featured = team.projects.slice(0, 3).map((p) => `**${p.name}**`);
    const featuredStr = joinHebrewList(featured);
    const word = n === 1 ? "פרויקט" : "פרויקטים";
    projectTail =
      n > featured.length
        ? `${n} ${word} — ביניהם ${featuredStr}`
        : `${n} ${word}: ${featuredStr}`;
  }

  if (memberPhrase && projectTail) {
    paragraphs.push(`הצוות מונה ${memberPhrase} ומוביל ${projectTail}.`);
  } else if (memberPhrase) {
    paragraphs.push(`הצוות מונה ${memberPhrase}.`);
  } else if (projectTail) {
    paragraphs.push(`הצוות מוביל ${projectTail}.`);
  }

  paragraphs.push(
    "אפשר לשאול אותי על חברי הצוות, תחומי האחריות, הפרויקטים, התהליכים והמושגים שלנו.",
  );
  paragraphs.push("**במה אפשר לעזור?**");

  return paragraphs.join("\n\n");
}
