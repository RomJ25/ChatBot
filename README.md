# Sniro workspace

pnpm monorepo that ships two Hebrew-RTL chatbots sharing one UI + one streaming LLM client, each with its own content shape and branding:

- **sniro** (`apps/sniro`) — team knowledge assistant. Content = team members, commander, projects, knowledge base. Port 5173.
- **de-vincho** (`apps/de-vincho`) — information chat scaffold. Content = persona + topics. Port 5174.
- **chatbot-core** (`packages/chatbot-core`) — shared React+Vite+TS component library: `ChatBot.tsx`, OpenAI-compatible SSE client, Markdown renderer, prompt helpers.

## Quickstart

```bash
pnpm install
cp .env.example apps/sniro/.env.local       # pick one preset, fill creds
cp .env.example apps/de-vincho/.env.local   # same
pnpm dev:sniro        # http://localhost:5173
pnpm dev:de-vincho    # http://localhost:5174
```

On Windows PowerShell, replace the `cp` lines with:

```powershell
Copy-Item .env.example apps\sniro\.env.local
Copy-Item .env.example apps\de-vincho\.env.local
```

If no LLM is configured, the app still loads and shows a config-hint bubble — it won't crash.

## Workspace scripts

| Command | What it does |
| --- | --- |
| `pnpm dev:<slug>` | Vite dev server (HMR) for sniro or de-vincho |
| `pnpm build:<slug>` | typecheck + build to `apps/<slug>/dist/` |
| `pnpm preview:<slug>` | serve the built dist locally |
| `pnpm -r typecheck` | typecheck every package |
| `pnpm prompt:<slug>` | print the composed system prompt + size (tokens/chars) |
| `pnpm doctor` | content health check — flags placeholders, duplicate IDs, missing descriptions, empty topics |
| `pnpm bundle:<slug>` | build a standalone Windows `.exe` → `out/<slug>.exe` |
| `pnpm bundle:all` | both `.exe`s |
| `pnpm extract -- <slug> <target>` | produce a workspace-free copy of one app for source handoff |

## LLM configuration

Each app reads its own `apps/<slug>/.env.local`:

```
VITE_LLM_BASE_URL=...
VITE_LLM_API_KEY=...
VITE_LLM_MODEL=...
```

`.env.example` at the repo root has ready-to-use presets for OpenAI, Groq, Anthropic, OpenRouter, Ollama, LM Studio, Pollinations, and a Vite-proxied internal endpoint. If the provider blocks browser-origin requests, set `LLM_UPSTREAM=...` and `VITE_LLM_BASE_URL=/api/llm` — Vite's dev/preview server will proxy and strip the CORS-triggering headers.

## Editing content

No code changes needed — each app has a typed content folder that the prompt builder consumes.

**sniro** (`apps/sniro/src/content/`):
- `team.ts` — name, commander, members, projects, tone. Single source of truth.
- `knowledge.ts` — free-form items (FAQ, glossary, process, links). Examples are commented at the bottom; copy, uncomment, edit.
- `sources/external.ts` — seam for future Confluence/Notion sync.

**de-vincho** (`apps/de-vincho/src/content/`):
- `persona.ts` — headline, self-ref, tone.
- `topics.ts` — topics array (`title`, `summary`, optional `details` in Markdown).

Run `pnpm prompt:sniro` (or `pnpm doctor`) after edits to preview the resulting system prompt and catch common pitfalls before the LLM sees them.

## Standalone `.exe`

`pnpm bundle:<slug>` produces a double-click-and-run Windows binary with the UI, a local HTTP server, and an LLM proxy baked in. API keys never reach the browser — the proxy injects `Authorization` server-side. See `doc/standalone-binary.md` for how end users configure and run it (including fully-offline operation via Ollama / LM Studio).

## Architecture notes

- `doc/retrieval-decision.md` — why there's no RAG layer yet, and the trip-wires that would justify adding one.
- `doc/standalone-binary.md` — the `.exe` launcher's design and operator guide.
- `doc/knowledge.md` — notes on the knowledge-base format.

## Workspace layout

```
.
├── apps/
│   ├── sniro/                # team product
│   └── de-vincho/            # persona/topics product
├── packages/
│   └── chatbot-core/         # shared UI + LLM client + prompt helpers
├── scripts/
│   ├── bundle.ts             # builds the Windows .exe
│   ├── launcher.ts           # what gets compiled into the .exe
│   ├── launcher/             # launcher helpers (proxy, env-io, setup page…)
│   ├── prompt-preview.ts     # pnpm prompt:<slug>
│   ├── doctor.ts             # pnpm doctor
│   └── extract.mjs           # standalone-source export
└── out/                      # built .exe files (gitignored)
```
