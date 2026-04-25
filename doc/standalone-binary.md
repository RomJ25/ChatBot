# Standalone `.exe` launcher

`sniro.exe` and `de-vincho.exe` are single-file Windows binaries that embed the Bun runtime, the pre-built chatbot UI, and a tiny HTTP server. Drop one into any folder and double-click it — the app opens in the default browser. No Node, no npm, no dev server.

## First run

1. Put `sniro.exe` (or `de-vincho.exe`) in a folder you can write to — Desktop, Documents, anywhere.
2. Double-click.
3. If Windows SmartScreen shows a warning ("Windows protected your PC"), click **More info → Run anyway**. The binary is unsigned; this is expected until a code-signing certificate is added.
4. The browser opens on `http://127.0.0.1:<random-port>/__app/setup`.
5. Pick a provider from the dropdown (OpenAI, Groq, Anthropic, OpenRouter, Ollama, LM Studio, Pollinations, or "custom"), paste your API key if the provider needs one, then click **שמור והתחל**.
6. The page reloads into the chat — ready to use.

The launcher writes `sniro.env` (or `de-vincho.env`) in the same folder as the `.exe`. That file is now your credential store.

## Subsequent runs

Double-click the `.exe`. It reads the sibling `.env` file and skips setup.

## Switching provider / rotating keys

Edit the `.env` file directly, or delete it to go back through the setup page on next launch.

```
# sniro.env (example)
LLM_UPSTREAM=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
```

## What's where

| File | Purpose |
|---|---|
| `sniro.exe` / `de-vincho.exe` | The launcher + embedded UI (~113 MB). |
| `sniro.env` / `de-vincho.env` | Your LLM credentials, written by first-run setup. Safe to edit by hand. |

## Troubleshooting

**"The browser didn't open."** The launcher logs the URL to its console window — copy it into the browser manually. On some locked-down Windows configurations `cmd /c start` is blocked.

**"I ran the `.exe` and the env file went somewhere weird."** The launcher writes the `.env` next to whatever folder Windows made the current directory at launch. For most users that's the folder containing the `.exe`. If you launch the binary from a Start menu shortcut or from `cmd` in an unrelated folder, the env file lands in that folder instead. Move the `.exe` to a dedicated folder and double-click from Explorer to get the default behavior.

**"Setup says the model is required."** It is — OpenAI-compatible endpoints require a model name in every request body. Pick any preset from the dropdown or consult your provider for a valid model identifier.

**"Two launchers in the same folder."** Fine — `sniro.exe` reads `sniro.env`, `de-vincho.exe` reads `de-vincho.env`. They don't collide.

## Offline operation

The `.exe` itself is fully offline-capable — every asset it serves (Heebo fonts, app JS, CSS, icons, setup page, favicon) is embedded in the binary. No CDN, no Google Fonts, no `fetch()` to anywhere except the configured LLM upstream.

The only thing that needs network is the LLM upstream you configure. Two fully offline options exist:

**Ollama (recommended for offline):** run `ollama serve` locally (downloads models once, then runs without internet). In the launcher setup, pick "Ollama" from the dropdown — it autofills `http://localhost:11434/v1`. Put the model name you've pulled (`ollama pull llama3.2` → model `llama3.2`). No API key.

**LM Studio:** start the local server from LM Studio's UI. In setup, pick "LM Studio" — autofills `http://localhost:1234/v1`. Put whatever model identifier LM Studio shows.

If you're configured for an internet provider (OpenAI, Groq, etc.) and the machine is offline, the launcher proxy returns a 502 with a readable error and the chat UI shows it — nothing crashes. Edit the `.env` file (or delete it to redo setup) to switch to a local provider.

## Security model

The API key lives in the sibling `.env` file and in memory inside the launcher process. It's **never** sent to the browser. The launcher exposes a local proxy at `/api/llm/*` that adds the `Authorization: Bearer` header server-side before forwarding to your upstream. The chat UI just talks to `http://127.0.0.1:<port>/api/llm` and doesn't know the key exists.

The server binds to `127.0.0.1` only — nothing is exposed on the network.

## Building from source

From the repo root on macOS or Linux (Bun installed):

```
pnpm install
pnpm bundle:sniro        # → out/sniro.exe
pnpm bundle:de-vincho    # → out/de-vincho.exe
pnpm bundle:all          # both
```

The bundler runs `pnpm -F <slug> build`, inlines the dist into `scripts/launcher/embedded.<slug>.*`, and invokes `bun build --compile --target=bun-windows-x64`. Do **not** pass `--bytecode` — it breaks cross-compiled Windows executables (oven-sh/bun#18416).

## Out of scope for v1

- macOS and Linux binaries. The launcher is platform-agnostic except `open-browser.ts`; adding targets is a small change.
- Code signing / notarization — SmartScreen warnings will persist until a signing certificate is in place.
- Custom icon and hidden console window — both require a Windows build host (Bun's `--windows-icon` / `--windows-hide-console` flags are unavailable when cross-compiling).
