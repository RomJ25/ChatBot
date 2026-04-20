import type { KnowledgeItem } from "../knowledge";

/*
 * ============================================================
 *  מקורות ידע חיצוניים — נקודת החיבור העתידית
 * ============================================================
 *
 *  הקובץ הזה הוא ה־seam היחיד בין הקוד לבין מקורות ידע
 *  שמגיעים מבחוץ (Confluence, Notion, Drive, ויקי פנימי וכו׳).
 *
 *  כרגע — ריק. כל הידע מוזן ידנית ב־knowledge.ts.
 *
 *  איך זה יעבוד כשנוסיף Confluence (בעתיד):
 *  -------------------------------------------------
 *  1) נכתוב סקריפט (למשל `npm run sync-confluence`) שמושך
 *     דפים רלוונטיים ומייצר קובץ:
 *         src/content/sources/confluence.generated.ts
 *     עם תוכן מהצורה:
 *         export const CONFLUENCE: KnowledgeItem[] = [
 *           { id: "cf.<page-id>", kind: "note", title: "...", body: "...",
 *             source: "confluence:SPACE/page-id",
 *             updatedAt: "2026-04-20T10:00:00Z" },
 *           ...
 *         ];
 *  2) נייבא את הקובץ כאן ונחבר ל־EXTERNAL:
 *         import { CONFLUENCE } from "./confluence.generated";
 *         export const EXTERNAL = [...CONFLUENCE];
 *  3) אין שינוי נוסף בקוד. `knowledge.ts` כבר מאחד אותו.
 *     זמן ריצה נשאר offline — הכל קבוע ב־bundle.
 *
 *  אותו דפוס יעבוד לכל מקור חיצוני אחר (Notion, Drive, RSS…).
 */

export const EXTERNAL: KnowledgeItem[] = [];
