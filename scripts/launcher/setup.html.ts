// Hebrew-RTL first-run setup page. Rendered by the launcher when no sibling
// env file is found. On submit, POSTs back to /__app/setup which persists the
// values and returns { ok: true }, at which point the client reloads /.

export type ProviderPreset = {
  id: string;
  label: string;
  upstream: string;
  model: string;
  apiKeyHint?: string;
  needsKey: boolean;
};

export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "custom",
    label: "הגדרה מותאמת אישית",
    upstream: "",
    model: "",
    needsKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    upstream: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyHint: "sk-...",
    needsKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    upstream: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyHint: "gsk_...",
    needsKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    upstream: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    apiKeyHint: "sk-ant-...",
    needsKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    upstream: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    apiKeyHint: "sk-or-...",
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (מקומי)",
    upstream: "http://localhost:11434/v1",
    model: "llama3.2",
    apiKeyHint: "ollama",
    needsKey: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio (מקומי)",
    upstream: "http://localhost:1234/v1",
    model: "local-model",
    apiKeyHint: "lm-studio",
    needsKey: false,
  },
  {
    id: "pollinations",
    label: "Pollinations (אנונימי)",
    upstream: "https://text.pollinations.ai/openai",
    model: "openai-fast",
    needsKey: false,
  },
];

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function renderSetupHtml(headline: string): string {
  // Inside a <script> element, HTML entity decoding is suppressed — so any
  // HTML-escaped quotes would be seen verbatim by the JS engine. Inline the
  // presets as a literal JSON-serialized JS expression instead, and guard
  // against `</script>` in the payload (none today, but a strict precaution).
  const presetsJs = JSON.stringify(PRESETS).replace(/</g, "\\u003c");
  const presetOptions = PRESETS.map(
    (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`,
  ).join("");
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(headline)} — הגדרה ראשונית</title>
<style>
  :root { --bg: #eef2f7; --card: #ffffff; --ink: #0f172a; --muted: #7f90a8;
          --accent: #2563eb; --border: rgba(37,99,235,0.2); }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink);
         font-family: "Heebo", ui-sans-serif, system-ui, "Segoe UI", "Arial Hebrew", Arial, sans-serif;
         display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
  .card { width: 100%; max-width: 560px; background: var(--card); border-radius: 24px;
          padding: 32px; box-shadow: 0 16px 40px -8px rgba(15,23,42,0.08),
          inset 0 1px 1px rgba(255,255,255,1); }
  h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -0.012em; }
  p.lead { margin: 0 0 24px; color: var(--muted); font-size: 14px; line-height: 1.55; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 6px; }
  input, select, textarea { width: 100%; padding: 10px 12px; border-radius: 12px;
    border: 1px solid var(--border); background: #fff; color: var(--ink);
    font: inherit; font-size: 14px; outline: none; transition: border-color .15s, box-shadow .15s; }
  input:focus, select:focus, textarea:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
  textarea { min-height: 80px; resize: vertical; }
  .row { margin-top: 8px; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
  button { margin-top: 24px; width: 100%; padding: 12px; border-radius: 14px;
    border: 0; color: #fff; font: inherit; font-weight: 600; cursor: pointer;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    box-shadow: 0 10px 30px -5px rgba(37,99,235,0.5); transition: transform .15s; }
  button:hover { transform: translateY(-1px); }
  button:active { transform: translateY(0) scale(.98); }
  button[disabled] { opacity: .6; cursor: wait; }
  .error { color: #b91c1c; font-size: 13px; margin-top: 12px; min-height: 1.2em; }
  details { margin-top: 16px; }
  summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); }
</style>
</head>
<body>
  <form class="card" id="f">
    <h1>${escapeHtml(headline)}</h1>
    <p class="lead">בחר ספק LLM או הזן כתובת משלך. ההגדרות נשמרות בקובץ לצד התוכנה ולא נשלחות לשום מקום.</p>

    <label for="preset">ספק</label>
    <select id="preset">${presetOptions}</select>

    <label for="upstream">כתובת שרת (LLM_UPSTREAM)</label>
    <input id="upstream" type="url" required placeholder="בחר ספק מהרשימה למעלה, או הזן כתובת" />

    <label for="model">דגם (LLM_MODEL)</label>
    <input id="model" type="text" required placeholder="שם הדגם בצד השרת" />

    <label for="apikey">מפתח API (LLM_API_KEY) — רשות</label>
    <input id="apikey" type="password" placeholder="השאר ריק לספקים ללא אימות (Ollama, LM Studio, Pollinations)" autocomplete="off" />
    <div class="hint">המפתח נשמר מקומית ומוזרק כ-Authorization בצד השרת — הוא לא נחשף לדפדפן.</div>

    <details>
      <summary>פרומפט מערכת (רשות)</summary>
      <div class="row">
        <textarea id="prompt" placeholder="השאר ריק כדי להשתמש בפרומפט המובנה של המוצר."></textarea>
      </div>
    </details>

    <button id="submit" type="submit">שמור והתחל</button>
    <div class="error" id="err"></div>
  </form>
<script>
  const PRESETS = ${presetsJs};
  const presetEl = document.getElementById("preset");
  const upstreamEl = document.getElementById("upstream");
  const modelEl = document.getElementById("model");
  const apikeyEl = document.getElementById("apikey");
  const promptEl = document.getElementById("prompt");
  const errEl = document.getElementById("err");
  const btn = document.getElementById("submit");

  presetEl.addEventListener("change", () => {
    const p = PRESETS.find(x => x.id === presetEl.value);
    if (!p || p.id === "custom") return;
    upstreamEl.value = p.upstream;
    modelEl.value = p.model;
    apikeyEl.placeholder = p.apiKeyHint || (p.needsKey ? "sk-..." : "");
  });

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "שומר...";
    try {
      const res = await fetch("/__app/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          LLM_UPSTREAM: upstreamEl.value.trim(),
          LLM_MODEL: modelEl.value.trim(),
          LLM_API_KEY: apikeyEl.value,
          LLM_SYSTEM_PROMPT: promptEl.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "שגיאה לא ידועה");
      }
      location.href = "/";
    } catch (e) {
      errEl.textContent = (e && e.message) ? e.message : String(e);
      btn.disabled = false;
      btn.textContent = "שמור והתחל";
    }
  });
</script>
</body>
</html>`;
}
