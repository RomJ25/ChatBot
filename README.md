# Sniro

העוזר החכם של צוות שניר — צ'אט RTL בעברית, מחובר ל-LLM תואם OpenAI.
React + Vite + Tailwind. כל התוכן (חברי צוות, פרויקטים, מאגר ידע) נערך בקבצי
TypeScript וה-system prompt נבנה מהם אוטומטית.

## Quickstart

```bash
npm install
cp .env.example .env.local   # ערוך ושים preset אחד בפועל
npm run dev                  # http://localhost:5173
```

אם לא מוגדר LLM, האפליקציה תעלה ותציג הודעה מנחה בצ'אט במקום להישבר.

## Scripts

| פקודה | מה עושה |
| --- | --- |
| `npm run dev` | שרת פיתוח (Vite, HMR) |
| `npm run build` | בדיקת טיפוסים + בנייה ל-`dist/` |
| `npm run preview` | מריץ את הבנייה מקומית |
| `npm run typecheck` | `tsc -b --noEmit` בלבד |

## הגדרת LLM

יוצרים `.env.local` (לא נכנס ל-git) ומגדירים שלושה משתנים:

```
VITE_LLM_BASE_URL=...
VITE_LLM_API_KEY=...
VITE_LLM_MODEL=...
```

`.env.example` כולל preset-ים מוכנים ל-OpenAI, Groq, Ollama, LM Studio,
Anthropic, OpenRouter, ונקודת קצה פנימית דרך proxy של Vite.

**נקודת קצה בלי CORS?** הגדר `LLM_UPSTREAM=http://internal-host/v1` ב-`.env.local`
ו-`VITE_LLM_BASE_URL=/api/llm`. שרת ה-dev וה-preview יפרוקסו את הבקשות.

**System prompt:** נבנה אוטומטית מ-`src/content/team.ts` + `src/content/knowledge.ts`.
לעקוף ידנית — הגדר `VITE_LLM_SYSTEM_PROMPT` ב-`.env.local`.

## עריכת תוכן

כל התוכן שהבוט יודע נמצא ב-`src/content/`. אין צורך לגעת בקוד אחר.

- **`team.ts`** — שם הצוות, מפקד/ת, חברי/ות, פרויקטים, טון. המקור היחיד לאמת.
- **`knowledge.ts`** — פריטי ידע חופשיים (FAQ, מושגים, תהליכים, קישורים, הערות).
  יש דוגמאות מוערות בתחתית הקובץ — העתק, בטל הערה, ערוך.
- **`sources/external.ts`** — seam למקורות חיצוניים (Confluence/Notion) לעתיד.

שינויים ב-dev נראים מיידית דרך Vite HMR. ל-production — `npm run build`.

## מבנה

```
src/
├── ChatBot.tsx            # הרכיב הראשי (UI, streaming, drag-drop, retry)
├── components/Markdown.tsx
├── content/               # המקור היחיד לאמת (ערוך כאן)
│   ├── team.ts
│   ├── knowledge.ts
│   ├── systemPrompt.ts    # בונה את ה-prompt מהנ"ל
│   └── sources/external.ts
├── llm/                   # לקוח OpenAI-compatible עם SSE
│   ├── index.ts           # createDefaultClient() — קורא מה-env
│   ├── openai-compat.ts
│   └── types.ts
└── main.tsx
```
