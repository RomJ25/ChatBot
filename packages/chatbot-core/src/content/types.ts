/*
 * ============================================================
 *  טיפוסי תוכן משותפים
 * ============================================================
 *
 *  טיפוסים שכל מוצר יכול לבחור להשתמש בהם כאשר הוא בונה את
 *  התוכן שלו. שום דבר כאן לא קובע איזו צורה "חייב" להיות לתוכן
 *  של מוצר — זו אופציה נוחה למוצרים שרוצים מאגר ידע.
 *
 *  טיפוסים ספציפיים לתחום (צוות, persona, topics וכו׳) מוגדרים
 *  בתוך apps/<product>/src/content/.
 */

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
