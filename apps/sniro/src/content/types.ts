/*
 * Team-specific content shape for sniro. Lives here (not in core) because
 * the shape is product-specific — de-vincho uses a different shape entirely.
 */

export type TeamMember = {
  /** שם מלא. */
  name: string;
  /** תפקיד/תואר (אופציונלי) — לדוג׳ "מפקדת הצוות", "קב״ר". */
  role?: string;
  /**
   * תחום האחריות — מה האדם אחראי עליו בפועל.
   * מומלץ לכל חבר/ת צוות. למפקד/ת אפשר להסתפק ב-role בלבד.
   */
  responsibility?: string;
};

export type Project = {
  name: string;
  description?: string;
  status?: string; // פעיל, בפיתוח, הושלם — אופציונלי
};

export type Tone = {
  voice: string;
  audience: string;
  language: string;
};

export type TeamContent = {
  name: string;
  short: string; // משפט אחד שמתאר את הצוות
  about?: string; // תיאור ארוך יותר (אופציונלי)
  commander?: TeamMember; // מפקד/ת — מוצג בנפרד אם קיים
  members: TeamMember[];
  projects: Project[];
  tone: Tone;
  welcome?: string; // הודעת פתיחה בצ'אט. אם ריק — נגזרת מ-name.
};
