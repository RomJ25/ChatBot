#!/usr/bin/env node
// scripts/safe-build.mjs — build the app with the LLM URL pinned to the
// in-server proxy path (/api/llm) and the API key blanked out. The build
// output is plain HTML/CSS/JS — no key in the bundle, no upstream URL in
// the bundle either.
//
// Cross-platform env injection: cmd.exe doesn't accept the POSIX
// `VAR=val command` form, so we spawn pnpm with env merged in here.

import { spawnSync } from "node:child_process";

const VALID = new Set(["sniro", "de-vincho"]);
const slug = process.argv[2];
if (!slug || !VALID.has(slug)) {
  console.error(`usage: node scripts/safe-build.mjs <${[...VALID].join("|")}>`);
  process.exit(1);
}

const useShell = process.platform === "win32";
const res = spawnSync("pnpm", ["-F", slug, "build"], {
  stdio: "inherit",
  shell: useShell,
  env: {
    ...process.env,
    // Force the runtime to talk to the in-server proxy. Any preset the user
    // had in .env.local is overridden — the safe path always proxies.
    VITE_LLM_BASE_URL: "/api/llm",
    // Blank in the bundle. The static server injects Authorization from
    // .env.local server-side; the browser bundle never sees the key.
    VITE_LLM_API_KEY: "",
  },
});
process.exit(res.status ?? 1);
