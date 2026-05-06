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

## Quickstart (any OS, online)

```bash
corepack enable          # one-time, gives you the right pnpm version
pnpm install             # also auto-creates apps/<slug>/.env.local via the postinstall hook
pnpm dev:sniro           # opens http://localhost:5173
pnpm dev:de-vincho       # opens http://localhost:5174
```

`pnpm install` runs `scripts/setup.mjs --quiet` as a `postinstall` hook so the two `.env.local` files are created automatically (idempotent — won't clobber existing files). With no API key configured the apps still load and show a "configuration required" state instead of crashing — useful for verifying the UI before wiring an LLM.

## Offline / air-gapped install (Windows team, no internet)

### Simplest fully-offline install (recommended for security-scanned Windows)

Build once on a connected machine, transfer one folder + Node installer to the Windows host, run. The Windows host gets **no `node_modules`, no `.pnpm-store`, no source, no unsigned third-party binaries** — just `dist/`, a single `serve.mjs`, your config, and the system `node.exe`.

**Step 1 — on a connected machine** (Mac / Linux / Windows with internet):

```bash
git clone <internal-repo>/Sniro.git && cd Sniro
corepack enable                                    # one-time; pnpm 10
pnpm install --offline --frozen-lockfile           # vendored store, no network
node scripts/safe-build.mjs de-vincho              # builds apps/de-vincho/dist/
node scripts/safe-deploy.mjs de-vincho             # writes deploy-de-vincho/
```

(Use `sniro` instead of `de-vincho` for the team-internal assistant. Run both commands twice for both apps.)

**Step 2 — also on the connected machine, gather two files for transfer:**

- `deploy-de-vincho/` (the whole folder, ~2.5 MiB)
- A signed Node 20+ Windows installer from https://nodejs.org/en/download/ (~30 MB `.msi`)

**Step 3 — transfer to the offline Windows machine** (USB, share, secure file transfer).

**Step 4 — on the offline Windows machine:**

1. Run the Node `.msi` installer (signed by OpenJS Foundation — clears SmartScreen).
2. Open `deploy-de-vincho\.env.local` in Notepad and fill in three values:
   - `LLM_UPSTREAM=` your model gateway URL (e.g. `http://localhost:11434/v1` for a local Ollama)
   - `VITE_LLM_API_KEY=` your API key (or leave blank for keyless local providers)
   - `VITE_LLM_MODEL=` the model identifier
3. Open a terminal in the `deploy-de-vincho\` folder and run:
   ```bat
   node serve.mjs
   ```
4. Open `http://127.0.0.1:5174/` in a browser.

That's it. The only executable that runs is the signed `node.exe`. Detailed security posture in [Scan-safe path](#scan-safe-path-for-avedr-protected-windows-machines) below.

**Why this is "fully offline":** the bundle is fully self-contained — every font, image, and JS asset is served from disk; the only network call is the LLM proxy hop to whatever `LLM_UPSTREAM` you configured. Use a local Ollama / LM Studio on the same machine for true zero-network operation.

---

### Detailed offline-install reference

This repo vendors pnpm's content-addressable package store, so a fresh `git clone` ships every npm dependency needed to build and run. **No network calls during install.**

```bash
git clone <internal-repo>/Sniro.git
cd Sniro
pnpm install --offline --frozen-lockfile    # reads tarballs from ./.pnpm-store
# Edit apps/sniro/.env.local: set VITE_LLM_BASE_URL, VITE_LLM_API_KEY,
# and VITE_LLM_MODEL to your team's internal gateway values.
pnpm dev:sniro
```

The `.npmrc` at repo root pins `store-dir=./.pnpm-store` and `prefer-offline=true`, so pnpm always uses the bundled store rather than the public registry. The store is marked binary in `.gitattributes` so Git doesn't try to delta-compress 8000+ gzipped tarballs.

Or skip pnpm entirely on Windows: build the `.exe` once on a connected machine (`pnpm bundle:sniro` → `out/sniro.exe`), commit it, and air-gapped users double-click. The launcher's first-run setup form prompts for the gateway URL.

### Refreshing the vendored store

When `pnpm-lock.yaml` changes (new dep added, version bump), regenerate the store on a machine **with internet**:

```bash
pnpm refresh-store        # one command — see scripts/refresh-vendored-store.mjs
git add .pnpm-store pnpm-lock.yaml
git commit -m "refresh vendored pnpm store"
```

The script:
1. Cleans `node_modules` and `.pnpm-store/`.
2. Runs `pnpm install --frozen-lockfile` to populate the store with **host-platform** binaries (esbuild, rollup).
3. Side-loads **Windows + Linux + macOS** native binaries (x64 and arm64 each) via a throwaway temp project (pnpm 10's `supportedArchitectures` config does not reliably populate the store with foreign-platform optional deps; this is the known workaround). Per-platform sanity checks fail loudly if any family didn't land.
4. Verifies `pnpm install --offline --frozen-lockfile` succeeds and both apps build, then re-asserts the per-platform check (pnpm 10 sometimes prunes store entries that aren't in the host's resolved dep graph).

To drop or add a deploy platform, edit `FOREIGN_PLATFORM_DEPS` in `scripts/refresh-vendored-store.mjs` **and** the matching entry in `.npmrc`'s `supportedArchitectures` — leaving them out of sync makes offline install fail loudly on the dropped platform.

### Picking a model provider

Open `apps/sniro/.env.local` (and the de-vincho one) and uncomment **one** preset:

| You want | Block to uncomment |
| --- | --- |
| OpenAI / Groq / Anthropic / OpenRouter (cloud) | `# ---- <provider> ----` |
| Ollama or LM Studio (offline, local) | `# ---- Ollama ----` / `# ---- LM Studio ----` |
| Pollinations (anonymous, instant test) | `# ---- Pollinations ----` |
| Internal / on-prem LiteLLM gateway | `# ---- Internal / air-gapped endpoint ----` |

The "internal" preset routes through the Vite dev/preview proxy (`/api/llm/*`) so the browser never sees the upstream URL and CORS can't bite you.

### Scan-safe path (for AV/EDR-protected Windows machines)

Corporate AV/EDR (Defender for Endpoint, CrowdStrike, SentinelOne) routinely flags the unsigned Bun-compiled `.exe` produced by `pnpm bundle:<slug>` — embedded runtime + no signature trips heuristic scanners regardless of what the code does. For deployments where the binary will land in front of one of those agents, use `scripts/serve-static.mjs` instead. The only executable that runs on the target is `node.exe` (signed by the OpenJS Foundation) — no Bun, no Vite at runtime, no compiled bundle.

```bash
pnpm install --offline --frozen-lockfile             # vendored store, no network
# Edit apps/de-vincho/.env.local — set LLM_UPSTREAM (server-side only,
# never inlined) and VITE_LLM_API_KEY (server-side only). Leave
# VITE_LLM_BASE_URL as is — safe-build pins it to /api/llm.
node scripts/safe-build.mjs de-vincho                # → apps/de-vincho/dist/
node scripts/serve-static.mjs de-vincho              # → http://127.0.0.1:5174/
```

Same two commands work for sniro (substitute `sniro` for `de-vincho`; default port 5173).

`scripts/serve-static.mjs` is a plain Node 20+ HTTP server that mirrors `scripts/launcher/proxy.ts`: drops Origin/Referer/Cookie + RFC 7230 hop-by-hop headers, injects `Authorization: Bearer` server-side from `.env.local`, 120s headers timeout, SSE-friendly response, returns 502 on upstream failure, binds to 127.0.0.1 only. The browser bundle never sees the upstream URL or the API key — both stay in the Node process. Strict CSP, X-Frame-Options DENY, nosniff, and no-referrer headers go on every response. Method allow-list (TRACE/CONNECT/PUT/PATCH → 405). Path traversal blocked for raw `../`, URL-encoded `%2e%2e`, null bytes, backslashes, drive letters, and symlinks. 2 MiB body cap on the proxy. Graceful EADDRINUSE / SIGINT / SIGTERM handling.

#### Minimal deploy bundle (no node_modules on the target)

After `pnpm install` the build chain leaves unsigned native binaries in `node_modules/` (esbuild ~10 MB, rollup `.node` addons). They're only needed at build time — `serve-static.mjs` itself imports only `node:*` built-ins. To keep those binaries off the security-scanned target:

```bash
node scripts/safe-build.mjs de-vincho
node scripts/safe-deploy.mjs de-vincho                  # default: scrubs .env.local
node scripts/safe-deploy.mjs de-vincho --with-secrets   # ships the source .env.local
```

`deploy-de-vincho/` contains exactly four things: `serve.mjs` (path-rewritten so it looks for files alongside itself), `dist/`, `.env.local`, `README.txt`. No `node_modules`, no `.pnpm-store`, no source. Total ~2.5 MiB. Transfer to the Windows machine and run `node serve.mjs` — the only executable on disk for runtime is the system `node.exe`.

**`.env.local` handling.** By default the bundle ships a placeholder `.env.local` so internal hostnames (e.g. an internal LLM gateway URL) and the API key don't ride in the file across DLP-scanned transfer paths — the operator fills in `LLM_UPSTREAM` and `VITE_LLM_API_KEY` on the target machine. Pass `--with-secrets` to copy the source `.env.local` verbatim when the bundle stays inside the trust zone end-to-end.

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
| `pnpm bootstrap` | (also runs as a `postinstall` hook) — creates `apps/<slug>/.env.local` from `.env.example` |
| `pnpm dev:<slug>` | Vite dev server (HMR) for sniro or de-vincho |
| `pnpm build:<slug>` | typecheck + build to `apps/<slug>/dist/` |
| `pnpm preview:<slug>` | serve the built dist locally |
| `pnpm typecheck` | typecheck every package |
| `pnpm prompt:<slug>` | print the composed system prompt + welcome (with token/char counts) |
| `pnpm run doctor` | content health check + LLM gateway reachability probe — flags placeholders, duplicate IDs, missing descriptions, empty topics, unreachable gateways |
| `pnpm refresh-store` | regenerate `.pnpm-store/` with multi-platform binaries (run when `pnpm-lock.yaml` changes) |
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
├── .pnpm-store/              # vendored npm tarball cache (committed, ~130 MB)
│                             # → enables `pnpm install --offline` on air-gapped machines
└── out/                      # built .exe files (gitignored by default; commit per-deployment if shipping prebuilt binaries)
```

## Troubleshooting

- **Windows + corepack denied**: run as Administrator, or fall back to `npm install -g pnpm@10.14.0`.
- **`pnpm install --offline` fails with "missing package"**: the `.pnpm-store/` was populated on a different OS than the deploy machine. Re-run the [Refreshing the vendored store](#refreshing-the-vendored-store) workflow on the deploy platform.
- **`pnpm install --offline` says "lockfile out of sync"**: someone bumped `package.json` without re-fetching. Either revert the bump or refresh the store.
- **Behind a corporate proxy**: set `HTTPS_PROXY` before any `pnpm install` on a connected machine — irrelevant on offline machines, which never call out.
- **Port 5173 already in use**: set `VITE_PORT=5180` in the relevant `.env.local`.
