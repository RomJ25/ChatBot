# Sniro workspace

pnpm monorepo that ships **two Hebrew-RTL chatbots** built on a shared streaming-LLM core. Same React component library, two completely different personas — distinct palettes, fonts, animations, and prompt shapes.

| App | Persona | Audience | Visual identity |
| --- | --- | --- | --- |
| **sniro** (`apps/sniro`) — port `5173` | The team's internal knowledge assistant. Knows the team's members, commander, projects, and FAQ. | Team members talking *about the team*. | Frosted-blue palette pulled from the unit crest. Hand-authored owl glyph in the chrome, full crest as the welcome hero, faint star-dust pattern in the background, single owl-wake blink on first paint, silver-wing shimmer when streaming. |
| **de-vincho** (`apps/de-vincho`) — port `5174` | Explainer of the *techno* world. Explains concepts, ideas and processes to anyone who asks; pulls answers from the team's knowledge base + Confluence. | Outsiders, students, anyone curious. | Aged-ivory parchment with iron-gall ink. Copper "dV" monogram in the chrome, a framed da Vinci portrait as the welcome hero, illuminated drop-cap on the first letter, candle-flicker brightness oscillation, manuscript margin rule on the leading edge. The streaming response is revealed at a **quill cadence** — char-class-aware timing with a quill-tip cursor that descends from above and pauses at punctuation. |
| **chatbot-core** (`packages/chatbot-core`) | Shared React + Vite + TS component library: `ChatBot.tsx`, OpenAI-compatible SSE client, Markdown renderer, prompt helpers, theme tokens. |

The two skins are driven entirely by per-app `theme.css` — no fork of the core component.

## Prerequisites

- **Node.js 20.10+** (22 LTS recommended; pinned in `.nvmrc`)
- **pnpm 10+** — easiest path: `corepack enable` (Node ships with corepack; this auto-resolves the `packageManager` field in `package.json`). Alternatively `npm install -g pnpm`.
- **bun 1.1+** — *only* needed for `pnpm doctor`, `pnpm prompt:<slug>`, and `pnpm bundle:<slug>`. The dev / build / preview workflow does not need bun.
- **Git 2.30+**

The app has no native dependencies — `pnpm install` is pure JS/TS.

## Quickstart (any OS)

```bash
corepack enable          # one-time, gives you the right pnpm version
pnpm install
pnpm bootstrap           # creates apps/<slug>/.env.local from .env.example
pnpm dev:sniro           # opens http://localhost:5173
pnpm dev:de-vincho       # opens http://localhost:5174
```

`pnpm bootstrap` is idempotent (won't clobber an existing `.env.local`) and prints the next steps. With no API key configured the apps still load and show a "configuration required" state instead of crashing — useful for verifying the UI before wiring an LLM.

### Picking a model provider

Open `apps/sniro/.env.local` (and the de-vincho one) and uncomment **one** preset:

| You want | Block to uncomment |
| --- | --- |
| OpenAI / Groq / Anthropic / OpenRouter (cloud) | `# ---- <provider> ----` |
| Ollama or LM Studio (offline, local) | `# ---- Ollama ----` / `# ---- LM Studio ----` |
| Pollinations (anonymous, instant test) | `# ---- Pollinations ----` |
| Internal / on-prem LiteLLM gateway | `# ---- Internal / air-gapped endpoint ----` |

The "internal" preset routes through the Vite dev/preview proxy (`/api/llm/*`) so the browser never sees the upstream URL and CORS can't bite you.

### Standalone `.exe` (Windows, no install needed)

`pnpm bundle:<slug>` produces a single-file Windows binary at `out/<slug>.exe` (~115 MB) with the UI, a local HTTP server, and an LLM proxy baked in.

**Double-click the `.exe`** — it picks a free port, opens your browser, and shows a Hebrew-RTL setup form. Pick a preset, paste your key, click **שמור והתחל**, and it's ready. The launcher writes a `<slug>.env` next to itself, so re-launching skips the form. The API key is stored locally and injected server-side; the browser bundle never sees it. See `doc/standalone-binary.md` for offline-only deployment with Ollama / LM Studio.

## Customizing a persona

Each `<ChatBot>` accepts these branding props on top of the message content:

| Prop | Purpose |
| --- | --- |
| `headline` | The H1 in the header (e.g. *"דה וינצ'ו — מסביר טכנו"*). |
| `logoUrl` | Path to a logo image. Used both in the header and as the avatar next to every bot bubble. SVG recommended; raster works for full-color marks. |
| `welcomeHeroUrl` | Path to a hero image rendered inside the welcome bubble. The shape (rounded-rect vs. circle), aspect ratio, fit, and frame are all driven by per-app CSS tokens — see `apps/<slug>/src/theme.css`. |
| `cadence` | `"frame"` (default) for snappy rAF-batched streaming, or `"quill"` for char-class-aware paced reveal with descend-from-above cursor. De-vincho uses `"quill"`. |
| `dropCap` | When `true`, the welcome bubble's first paragraph gets a floated drop-cap initial in `--font-display`. De-vincho uses this; sniro doesn't. |
| `botName` | Sender label shown above each bot bubble. Defaults to `"מערכת פנימית"`; sniro overrides to `TEAM.name`, de-vincho to `"לאונרדו"`. |
| `thinkingText` | Text next to the typing-indicator dots. Sniro: *"מחפש בידע…"*, de-vincho: *"הקולמוס מטבל בדיו…"*. |

Visual tokens (color, font, gradient, animation) live in `apps/<slug>/src/theme.css` and override the defaults in `packages/chatbot-core/src/index.css`. The two existing themes are documented at the top of each file.

`prefers-reduced-motion: reduce` is honored across the board: candle flicker, quill cadence, owl-wake, and decorative animations all disable cleanly.

## Editing content

No code changes needed — each app has a typed content folder consumed by the prompt builder.

**sniro** (`apps/sniro/src/content/`):
- `team.ts` — name, commander, members, projects, tone. Single source of truth.
- `knowledge.ts` — free-form items (FAQ, glossary, process, links). Examples are commented at the bottom; copy, uncomment, edit.
- `sources/external.ts` — seam for future Confluence/Notion sync.

**de-vincho** (`apps/de-vincho/src/content/`):
- `persona.ts` — headline, self-ref, tone, plus an optional `welcome` string. The welcome currently sets the outward-facing framing ("explains the techno world to anyone who asks").
- `topics.ts` — array of techno concepts/processes/ideas the bot can answer authoritatively. Empty by default; populate from your team's Confluence. The system prompt has a graceful empty-topics path that defers team-specific questions to Confluence and only answers general concept questions from the model's own knowledge.

Run `pnpm prompt:sniro` / `pnpm prompt:de-vincho` after edits to preview the composed system prompt and welcome message before they reach an LLM. `pnpm doctor` flags placeholders, duplicate IDs, missing descriptions, and empty topics.

## Workspace scripts

| Command | What it does |
| --- | --- |
| `pnpm bootstrap` | one-time first-run — creates `apps/<slug>/.env.local` from `.env.example` |
| `pnpm dev:<slug>` | Vite dev server (HMR) for sniro or de-vincho |
| `pnpm build:<slug>` | typecheck + build to `apps/<slug>/dist/` |
| `pnpm preview:<slug>` | serve the built dist locally |
| `pnpm typecheck` | typecheck every package |
| `pnpm prompt:<slug>` | print the composed system prompt + welcome (with token/char counts) |
| `pnpm run doctor` | content health check — flags placeholders, duplicate IDs, missing descriptions, empty topics |
| `pnpm bundle:<slug>` | build a standalone Windows `.exe` → `out/<slug>.exe` |
| `pnpm bundle:all` | both `.exe`s |
| `pnpm extract -- <slug> <target>` | produce a workspace-free copy of one app for source handoff |

> **Note:** `pnpm doctor` (without `run`) is also valid but pnpm 10 reserves `doctor` as a builtin; using `pnpm run doctor` is unambiguous.

## Architecture notes

- `doc/retrieval-decision.md` — why there's no RAG layer yet and the trip-wires that would justify adding one. De-vincho's empty-topics fallback is the current substitute.
- `doc/standalone-binary.md` — the `.exe` launcher's design and operator guide (CSRF protection on the setup endpoint, hop-by-hop header stripping in the LLM proxy, BOM handling, bad-cwd warnings).
- `doc/retrieval-decision.md`, `doc/knowledge.md` — knowledge-base format notes.

## Workspace layout

```
.
├── apps/
│   ├── sniro/                # team-internal assistant
│   │   ├── public/
│   │   │   ├── owl-mark.svg            # header glyph + favicon
│   │   │   ├── welcome-crest.jpg       # welcome-bubble hero
│   │   │   └── favicon.svg
│   │   └── src/theme.css               # frosted-blue palette + owl-wake
│   └── de-vincho/            # outward techno explainer
│       ├── public/
│       │   ├── monogram.svg            # header chrome + favicon
│       │   ├── welcome-portrait.jpg    # welcome-bubble hero
│       │   └── favicon.svg
│       └── src/theme.css               # parchment palette + quill caret
├── packages/
│   └── chatbot-core/         # shared UI + LLM client + prompt helpers + theme tokens
├── scripts/
│   ├── bundle.ts             # builds the Windows .exe
│   ├── launcher.ts           # what gets compiled into the .exe
│   ├── launcher/             # launcher helpers (proxy, env-io, setup page…)
│   ├── prompt-preview.ts     # pnpm prompt:<slug>
│   ├── doctor.ts             # pnpm run doctor
│   ├── setup.mjs             # pnpm bootstrap
│   └── extract.mjs           # standalone-source export
└── out/                      # built .exe files (gitignored)
```
