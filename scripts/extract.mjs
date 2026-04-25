#!/usr/bin/env node
/**
 * Extract one workspace app into a fully standalone folder.
 *
 * Usage:  node scripts/extract.mjs <app-slug> <target-dir>
 * Example: node scripts/extract.mjs sniro /tmp/sniro-standalone
 *
 * What it does:
 *   1) Copies apps/<slug>/ → target/ (skipping node_modules, dist, .vite).
 *   2) Copies packages/chatbot-core/src/ → target/src/core/.
 *   3) Adds a Vite + TS alias so "@sniro/chatbot-core" → "./src/core".
 *   4) Drops the "workspace:*" dep and merges core's peerDependencies into
 *      the target's dependencies.
 *   5) Removes the cross-package entry from tailwind.config.js (./src/** already
 *      catches ./src/core/).
 *   6) Writes EXTRACTED.md with the source + date.
 *
 * Result: the target folder has no workspace ties. `npm install && npm run dev`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");

async function main() {
  const [slug, rawTarget] = process.argv.slice(2);
  if (!slug || !rawTarget) {
    console.error("usage: node scripts/extract.mjs <app-slug> <target-dir>");
    process.exit(1);
  }
  const target = path.resolve(rawTarget);
  const appDir = path.join(WORKSPACE, "apps", slug);
  const coreSrc = path.join(WORKSPACE, "packages/chatbot-core/src");

  if (!(await exists(appDir))) {
    console.error(`app not found: ${appDir}`);
    process.exit(1);
  }
  if (await exists(target)) {
    console.error(`target already exists: ${target}`);
    process.exit(1);
  }

  // 1. Copy the app.
  await fs.cp(appDir, target, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${path.sep}node_modules${path.sep}`) &&
      !src.endsWith(`${path.sep}node_modules`) &&
      !src.includes(`${path.sep}dist${path.sep}`) &&
      !src.endsWith(`${path.sep}dist`) &&
      !src.includes(`${path.sep}.vite`) &&
      !src.endsWith(".tsbuildinfo"),
  });

  // 2. Copy core source into target/src/core/.
  await fs.cp(coreSrc, path.join(target, "src/core"), { recursive: true });

  // 3. Patch vite.config.ts — add alias + drop optimizeDeps.exclude.
  await patchViteConfig(path.join(target, "vite.config.ts"));

  // 4. Patch tsconfig.app.json — add baseUrl + paths.
  await patchTsconfig(path.join(target, "tsconfig.app.json"));

  // 5. Patch package.json — drop workspace:* dep, merge core peerDeps.
  await patchPackageJson(path.join(target, "package.json"), slug);

  // 6. Patch tailwind.config.js — drop the cross-package glob.
  await patchTailwind(path.join(target, "tailwind.config.js"));

  // 7. .gitignore (standalone-friendly).
  await fs.writeFile(
    path.join(target, ".gitignore"),
    [
      "node_modules",
      "dist",
      ".DS_Store",
      "*.log",
      ".vite",
      ".env.local",
      ".env.*.local",
      "*.tsbuildinfo",
      "",
    ].join("\n"),
  );

  // 8. EXTRACTED.md breadcrumb + push instructions.
  const now = new Date().toISOString().slice(0, 10);
  await fs.writeFile(
    path.join(target, "EXTRACTED.md"),
    `# ${slug}

Extracted from the sniro-workspace on ${now}.

Source: \`apps/${slug}/\` + \`packages/chatbot-core/\` (inlined at \`src/core/\`).

## Run locally

\`\`\`
npm install
npm run dev
\`\`\`

## Push to a new GitHub repo

\`\`\`
cd ${rawTarget}
git init
git add .
git commit -m "initial commit — ${slug} extracted from sniro-workspace"
gh repo create ${slug} --private --source=. --push   # or: git remote add origin <url> && git push -u origin main
\`\`\`

The folder has no ties to the workspace (no \`workspace:*\` deps, no external
\`extends\` paths). Any future edits to \`packages/chatbot-core/\` in the workspace
need to be re-extracted or ported manually.
`,
  );

  console.log(`extracted ${slug} → ${target}`);
  console.log(`next: cd ${rawTarget} && npm install && npm run dev`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function patchViteConfig(file) {
  let s = await fs.readFile(file, "utf8");
  // Drop the optimizeDeps.exclude line for the workspace package (not needed
  // once core is inlined).
  s = s.replace(
    /\n\s*\/\/ Without this[^\n]*\n\s*\/\/ core-source edits[^\n]*\n\s*optimizeDeps: \{ exclude: \["@sniro\/chatbot-core"\] \},\n/,
    "\n",
  );
  // Inject "path" import + alias into the config.
  if (!s.includes('from "node:path"')) {
    s = `import path from "node:path";\nimport { fileURLToPath } from "node:url";\n` + s;
  }
  if (!s.includes("const __dirname =")) {
    s = s.replace(
      /from "@vitejs\/plugin-react";\n/,
      `from "@vitejs/plugin-react";\n\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));\n`,
    );
  }
  // Insert resolve.alias before `server:`. Matches the indented return object.
  s = s.replace(
    /(\n\s*)server: \{ port, open: true, proxy \},/,
    `$1resolve: {$1  alias: {$1    "@sniro/chatbot-core": path.resolve(__dirname, "src/core"),$1    "@sniro/chatbot-core/index.css": path.resolve(__dirname, "src/core/index.css"),$1  },$1},$1server: { port, open: true, proxy },`,
  );
  await fs.writeFile(file, s);
}

async function patchTsconfig(file) {
  const json = JSON.parse(await fs.readFile(file, "utf8"));
  // Inline the workspace's base compilerOptions — extract target has no parent.
  const baseJson = JSON.parse(
    await fs.readFile(path.join(WORKSPACE, "tsconfig.base.json"), "utf8"),
  );
  delete json.extends;
  json.compilerOptions = {
    ...(baseJson.compilerOptions ?? {}),
    ...(json.compilerOptions ?? {}),
    baseUrl: ".",
    paths: {
      "@sniro/chatbot-core": ["src/core/index.ts"],
      "@sniro/chatbot-core/index.css": ["src/core/index.css"],
    },
  };
  await fs.writeFile(file, JSON.stringify(json, null, 2) + "\n");
}

async function patchPackageJson(file, slug) {
  const pkg = JSON.parse(await fs.readFile(file, "utf8"));
  const corePkg = JSON.parse(
    await fs.readFile(
      path.join(WORKSPACE, "packages/chatbot-core/package.json"),
      "utf8",
    ),
  );

  pkg.dependencies = pkg.dependencies ?? {};
  delete pkg.dependencies["@sniro/chatbot-core"];

  // Merge core's peerDeps into the extracted app's dependencies (apps don't
  // have peers — the extracted app is the consumer).
  for (const [name, spec] of Object.entries(corePkg.peerDependencies ?? {})) {
    if (!pkg.dependencies[name]) {
      pkg.dependencies[name] = spec;
    }
  }

  pkg.name = slug;
  await fs.writeFile(file, JSON.stringify(pkg, null, 2) + "\n");
}

async function patchTailwind(file) {
  let s = await fs.readFile(file, "utf8");
  // Remove the path.resolve(...) line and any trailing comma on the line above.
  s = s.replace(
    /\n\s*\/\/ Scan the workspace core[^\n]*\n\s*path\.resolve\([^)]*chatbot-core[^)]*\),\n/,
    "\n",
  );
  await fs.writeFile(file, s);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
