#!/usr/bin/env node
// Refresh ./.pnpm-store/ so that an air-gapped clone can run
// `pnpm install --offline --frozen-lockfile` on **any** target platform —
// not just the platform of the prep machine.
//
// Why this script exists:
//   pnpm 10's `supportedArchitectures` config does not reliably populate
//   the store with foreign-platform optional dependencies (esbuild's
//   per-OS native binaries, rollup's per-OS native binaries) when run
//   from a different host. We tried .npmrc, env vars, CLI flags, and
//   --config JSON syntax — none triggered Windows tarballs to be fetched
//   on a macOS/Linux prep machine.
//
//   Workaround: install the platform-specific tarballs into the same
//   project store via a throwaway side-project that lists them as
//   direct dependencies. pnpm then downloads + indexes them in the
//   shared CAS store, where the main project's `pnpm install --offline`
//   on the deploy machine will find them by package@version match.
//
// Usage:
//   node scripts/refresh-vendored-store.mjs
//
// Prerequisite: this machine has internet. The script deletes node_modules
// and the existing .pnpm-store and re-creates them from scratch.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const storeDir = path.join(repoRoot, ".pnpm-store");

// Native-binary packages whose foreign-platform variants must land in the
// store for an offline install to succeed on every platform `.npmrc`'s
// supportedArchitectures advertises (current host + win32 + linux + darwin,
// across x64 + arm64). Versions come from pnpm-lock.yaml and must be kept
// in sync with whatever the lockfile resolves esbuild and rollup to.
//
// Host-platform binaries (e.g. darwin-arm64 when prepping on a M-series Mac)
// land via the main `pnpm install` in step [2/4] below — they're not listed
// here. Everything else is side-loaded.
//
// If you drop a deploy target, prune both this list AND the matching
// `supportedArchitectures` entry in .npmrc — leaving the .npmrc claim
// without the matching tarballs makes offline install fail loudly on
// the dropped platform.
const FOREIGN_PLATFORM_DEPS = [
  // Windows (deploy target for the .exe; also covers Windows clones)
  "@esbuild/win32-x64",
  "@esbuild/win32-arm64",
  "@rollup/rollup-win32-x64-msvc",
  "@rollup/rollup-win32-arm64-msvc",
  // Linux x64 + arm64 (CI / server-side prep)
  "@esbuild/linux-x64",
  "@esbuild/linux-arm64",
  "@rollup/rollup-linux-x64-gnu",
  "@rollup/rollup-linux-arm64-gnu",
  // macOS Intel (darwin-arm64 is whatever the prep host already covers; if
  // the prep host happens to be Intel, darwin-x64 is host and darwin-arm64
  // shows up here instead — the side-load is idempotent either way).
  "@esbuild/darwin-x64",
  "@esbuild/darwin-arm64",
  "@rollup/rollup-darwin-x64",
  "@rollup/rollup-darwin-arm64",
];

// Cross-platform command runner.
//
// On Windows, `pnpm` resolves to `pnpm.cmd` (a batch shim that corepack /
// `npm i -g pnpm` both install). Node's execFileSync cannot directly run
// .cmd / .bat — it requires the cmd.exe shell to interpret them. Setting
// shell:true on Windows hands the line to cmd.exe so the shim resolves.
//
// shell:true on Windows then means args are joined with spaces — so any
// arg containing whitespace must be wrapped in double quotes, otherwise
// cmd.exe splits it (e.g. a tmpdir under "C:\Users\My Name\AppData\Local\
// Temp\..." would be parsed as multiple args). On POSIX we keep
// shell:false; Node's execFile passes the args as a real argv array there.
function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}${opts.cwd ? `   (in ${opts.cwd})` : ""}`);
  const useShell = process.platform === "win32";
  const finalArgs = useShell
    ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a))
    : args;
  execFileSync(cmd, finalArgs, {
    stdio: "inherit",
    cwd: opts.cwd ?? repoRoot,
    shell: useShell,
  });
}

async function countStoreEntries(pattern) {
  const indexDir = path.join(storeDir, "v10", "index");
  if (!(await fs.access(indexDir).then(() => true).catch(() => false))) return 0;
  const subdirs = await fs.readdir(indexDir);
  let count = 0;
  for (const sub of subdirs) {
    const files = await fs.readdir(path.join(indexDir, sub)).catch(() => []);
    count += files.filter((f) => pattern.test(f)).length;
  }
  return count;
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function readVersionFromLockfile(packageName) {
  const lock = await fs.readFile(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const re = new RegExp(`'${packageName.replace(/[.+]/g, "\\$&")}@([\\d.]+)':`, "m");
  const m = lock.match(re);
  if (!m) {
    throw new Error(`could not find ${packageName} in pnpm-lock.yaml`);
  }
  return m[1];
}

async function main() {
  console.log(`Refreshing vendored pnpm store at ${storeDir}`);
  console.log(`Host platform: ${os.platform()} ${os.arch()}`);

  // Step 1: clean state
  console.log("\n[1/4] Clean state");
  await fs.rm(path.join(repoRoot, "node_modules"), { recursive: true, force: true });
  for (const sub of ["apps/sniro", "apps/de-vincho", "packages/chatbot-core"]) {
    await fs.rm(path.join(repoRoot, sub, "node_modules"), {
      recursive: true,
      force: true,
    });
  }
  await fs.rm(storeDir, { recursive: true, force: true });

  // Step 2: populate store with host-platform binaries via main install
  console.log("\n[2/4] Populate store with host-platform deps");
  run("pnpm", ["install", "--frozen-lockfile"]);

  // Step 3: side-load foreign-platform binaries via throwaway project
  console.log("\n[3/4] Side-load foreign-platform binaries via temp project");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pnpm-store-refresh-"));
  try {
    const deps = {};
    for (const dep of FOREIGN_PLATFORM_DEPS) {
      const version = await readVersionFromLockfile(dep);
      deps[dep] = version;
      console.log(`  · ${dep}@${version}`);
    }
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify(
        { name: "store-refresh", version: "0.0.0", dependencies: deps },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(tmp, ".npmrc"),
      `store-dir=${storeDir}\npackage-import-method=copy\n`,
    );
    // Use --dir explicitly so pnpm doesn't traverse upward and pick up the
    // workspace package.json instead of our temp project. The cwd: tmp
    // option of execFileSync alone is not enough — pnpm v10 searches
    // upward from cwd for package.json and may match the workspace root.
    // Explicit --config.store-dir=<absolute>: relying on the temp dir's
    // .npmrc isn't enough — when pnpm is spawned via execFileSync, it
    // initializes its own store-dir resolution and may create a local
    // .pnpm-store inside the temp dir instead of using ours.
    run(
      "pnpm",
      [
        "install",
        "--dir",
        tmp,
        "--config.store-dir=" + storeDir,
        "--ignore-scripts",
        "--no-optional",
      ],
      { cwd: tmp },
    );
    // Per-platform sanity check: each family in FOREIGN_PLATFORM_DEPS must
    // be represented in the store, otherwise an offline install on that
    // platform will fail. We can't assert host-platform here (those land
    // via step [2/4]'s main install, before this side-load runs).
    const platformChecks = [
      { label: "win32", re: /win32/ },
      { label: "linux", re: /linux/ },
      { label: "darwin", re: /darwin/ },
    ];
    for (const { label, re } of platformChecks) {
      const count = await countStoreEntries(re);
      console.log(`  · ${label} entries in store: ${count}`);
      if (count === 0) {
        throw new Error(
          `side-load failed — no ${label} entries landed in the project store. ` +
            "Check that --config.store-dir flag was honored.",
        );
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  // Step 4: pre-flight verification — offline install + builds must succeed
  console.log("\n[4/4] Verify offline install works");
  await fs.rm(path.join(repoRoot, "node_modules"), { recursive: true, force: true });
  for (const sub of ["apps/sniro", "apps/de-vincho", "packages/chatbot-core"]) {
    await fs.rm(path.join(repoRoot, sub, "node_modules"), {
      recursive: true,
      force: true,
    });
  }
  run("pnpm", ["install", "--offline", "--frozen-lockfile"]);
  run("pnpm", ["-F", "sniro", "build"]);
  run("pnpm", ["-F", "de-vincho", "build"]);
  // Re-check after step 4's offline install — pnpm 10 sometimes prunes
  // store entries that aren't in the lockfile-resolved dep graph for the
  // current host. If that pruning kicked in, the foreign-platform tarballs
  // we side-loaded would be gone before the commit.
  for (const { label, re } of [
    { label: "win32", re: /win32/ },
    { label: "linux", re: /linux/ },
    { label: "darwin", re: /darwin/ },
  ]) {
    const finalCount = await countStoreEntries(re);
    if (finalCount === 0) {
      throw new Error(
        `post-verification check: no ${label} entries in store. The vendored ` +
          `store will not work for ${label} users. Aborting before commit.`,
      );
    }
  }

  console.log(
    "\n✓ Store refresh complete. Commit with:\n" +
      "    git add .pnpm-store pnpm-lock.yaml\n" +
      "    git commit -m \"refresh vendored pnpm store\"\n",
  );
}

main().catch((err) => {
  console.error("\nstore refresh failed:", err);
  process.exit(1);
});
