/*
 * ============================================================
 *  מאגר ידע (Knowledge Base) — פריטים חופשיים
 * ============================================================
 *
 *  הקובץ הזה הוא המקום לפריטי ידע שלא מתאימים למבנה של
 *  חברי צוות / פרויקטים (שנמצאים ב־team.ts).
 *  דוגמאות: שאלות נפוצות, מילון מושגים, תיאורי תהליכים,
 *           קישורים לחומרי עומק, הערות כלליות.
 *
 *  כל פריט הוא יחידה עצמאית עם id יציב — כדי שה־LLM יוכל
 *  להתייחס אליו במפורש והממשק יוכל להציג אותו ככרטיס.
 *
 *  איך להוסיף פריט:
 *  ----------------
 *    • העתק אחת מהדוגמאות בסוף הקובץ למערך HAND_AUTHORED.
 *    • שנה את id ל־מזהה ייחודי (רצוי kind.שם).
 *    • מלא title ו־body (body תומך ב־Markdown).
 *    • תגיות (tags) אופציונליות — לסינון עתידי בממשק.
 *
 *  איך זה נצרך:
 *    • buildSystemPrompt() מכניס את כל הפריטים ל־prompt
 *      של ה־LLM, מקובצים לפי kind תחת כותרות בעברית.
 *    • כאשר נחבר מקור חיצוני (Confluence/Notion) — הפריטים
 *      משם יצטרפו לכאן אוטומטית דרך sources/external.ts.
 */

import { EXTERNAL } from "./sources/external";

export type KnowledgeKind =
  | "faq" // שאלה נפוצה
  | "glossary" // מושג / מונח
  | "process" // תהליך
  | "link" // קישור חיצוני
  | "note"; // הערה חופשית

export type KnowledgeItem = {
  id: string; // מזהה ייחודי, יציב לאורך זמן (לדוג׳ "glossary.molecule")
  kind: KnowledgeKind;
  title: string;
  body: string; // Markdown
  tags?: string[]; // לסינון בממשק (אופציונלי)
  source?: string; // "hand" ברירת־מחדל. בעתיד: "confluence:SPACE/page", "notion:...", וכו׳.
  updatedAt?: string; // ISO 8601, אופציונלי
};

/**
 * פריטים שנכתבים ונערכים ידנית כאן בקובץ.
 * (פריטים ממקורות חיצוניים נכנסים דרך sources/external.ts)
 */
const HAND_AUTHORED: KnowledgeItem[] = [
  // ──────────────────────────────────────────────────────────
  // הוסף פריטים כאן. הסר את ה־// כדי להפעיל את הדוגמאות.
  // ──────────────────────────────────────────────────────────
  //
  // {
  //   id: "glossary.molecule",
  //   kind: "glossary",
  //   title: "מולקולה",
  //   body: "יחידה לוגית בתוך המכלול. כל מולקולה אחראית על תחום ספציפי וכל חבר צוות אחראי על מולקולה אחת או יותר.",
  //   tags: ["מבנה"],
  // },
  //
  // {
  //   id: "glossary.binyan-koach",
  //   kind: "glossary",
  //   title: "בניין כוח",
  //   body: "תהליך של הכשרה והעמקת ידע עבור חברי הצוות בתחום מסוים, כדי להגדיל את העומק המקצועי של המולקולה.",
  //   tags: ["תהליך"],
  // },
  //
  // {
  //   id: "faq.contact",
  //   kind: "faq",
  //   title: "איך יוצרים קשר עם הצוות?",
  //   body: "ניתן לפנות ישירות לכל אחד מחברי הצוות או למפקדת הצוות (ליאם כהן).",
  //   tags: ["קשר"],
  // },
  //
  // {
  //   id: "process.new-project",
  //   kind: "process",
  //   title: "כיצד נבחרים פרויקטים חדשים",
  //   body: "פרויקטים חדשים מתחילים כיוזמה של חבר צוות, עוברים תיאום מול המפקדת ונכנסים לתעדוף הצוותי.",
  //   tags: ["תהליך", "פרויקטים"],
  // },
  //
  // {
  //   id: "link.wiki-home",
  //   kind: "link",
  //   title: "ויקי הצוות",
  //   body: "**כתובת:** https://example.internal/wiki/sniro",
  //   tags: ["קישור"],
  // },
];

/**
 * כל פריטי הידע מכל המקורות, מאוחדים. צרכנים (prompt builder,
 * בעתיד — כרטיסים בממשק) צריכים רק את הרשימה הזו.
 */
export const KNOWLEDGE: KnowledgeItem[] = [...HAND_AUTHORED, ...EXTERNAL];

/** כל הפריטים מקטגוריה מסוימת. */
export function knowledgeByKind(
  kind: KnowledgeKind,
  items: KnowledgeItem[] = KNOWLEDGE,
): KnowledgeItem[] {
  return items.filter((i) => i.kind === kind);
}
