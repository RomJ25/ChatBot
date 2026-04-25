// Content health check. Run before shipping to catch common pitfalls that
// quietly degrade LLM behavior — placeholders left in, empty descriptions
// that invite hallucination on weak models, duplicate IDs, etc.
//
// Usage:
//   bun scripts/doctor.ts               — checks both apps
//   bun scripts/doctor.ts sniro         — single app

import path from "node:path";
import { pathToFileURL } from "node:url";

type Finding = { level: "error" | "warn" | "info"; slug: string; msg: string };

const findings: Finding[] = [];
const push = (level: Finding["level"], slug: string, msg: string) =>
  findings.push({ level, slug, msg });

const repoRoot = path.resolve(import.meta.dir, "..");
const base = (slug: string) => path.join(repoRoot, "apps", slug, "src", "content");

// On Windows, ESM dynamic import() rejects absolute paths like
// "C:\\foo\\bar.ts" — they must be wrapped as file:// URLs first.
const importPath = (p: string) => pathToFileURL(p).href;

const want = process.argv[2];

async function checkSniro(): Promise<void> {
  const slug = "sniro";
  const { TEAM } = await import(importPath(path.join(base(slug), "team.ts")));
  const { KNOWLEDGE } = await import(importPath(path.join(base(slug), "knowledge.ts")));

  if (!TEAM.name?.trim()) push("error", slug, "TEAM.name is empty");
  if (!TEAM.short?.trim()) push("warn", slug, "TEAM.short is empty (used in welcome)");
  if (!TEAM.commander) {
    push("info", slug, "no commander set — welcome will omit the line");
  }

  // Weak-model hallucination guard: projects with just a name tempt the model
  // to invent a description. The sniro prompt says "don't invent", but
  // weaker providers (e.g. Pollinations) don't follow that strictly.
  const projectsNoDesc = (TEAM.projects ?? []).filter(
    (p: { description?: string }) => !p.description?.trim(),
  );
  if (projectsNoDesc.length) {
    const names = projectsNoDesc
      .map((p: { name: string }) => p.name)
      .join(", ");
    push(
      "warn",
      slug,
      `${projectsNoDesc.length} project(s) without description: ${names}. ` +
        "Weak models may hallucinate a description; strong models are fine.",
    );
  }

  const names = new Set<string>();
  for (const m of TEAM.members ?? []) {
    if (!m.name?.trim()) push("error", slug, "member with empty name");
    else if (names.has(m.name)) push("error", slug, `duplicate member name: ${m.name}`);
    else names.add(m.name);
    if (!m.responsibility?.trim() && !m.role?.trim()) {
      push("warn", slug, `member "${m.name}" has neither role nor responsibility`);
    }
  }

  const projectNames = new Set<string>();
  for (const p of TEAM.projects ?? []) {
    if (!p.name?.trim()) push("error", slug, "project with empty name");
    else if (projectNames.has(p.name))
      push("error", slug, `duplicate project name: ${p.name}`);
    else projectNames.add(p.name);
  }

  const ids = new Set<string>();
  for (const item of KNOWLEDGE ?? []) {
    if (!item.id?.trim()) push("error", slug, "knowledge item with empty id");
    else if (ids.has(item.id))
      push("error", slug, `duplicate knowledge id: ${item.id}`);
    else ids.add(item.id);
    if (!item.title?.trim())
      push("warn", slug, `knowledge "${item.id}" has empty title`);
    if (!item.body?.trim())
      push("warn", slug, `knowledge "${item.id}" has empty body`);
  }

  if (!TEAM.tone || !TEAM.tone.language) {
    push("warn", slug, "TEAM.tone.language is not set — model may reply in wrong language");
  }
}

async function checkDeVincho(): Promise<void> {
  const slug = "de-vincho";
  const { PERSONA } = await import(importPath(path.join(base(slug), "persona.ts")));
  const { TOPICS } = await import(importPath(path.join(base(slug), "topics.ts")));

  // The scaffolded persona still literally says "placeholder"; this is the
  // main thing a team picking up the scaffold needs to fix first.
  if (/placeholder/i.test(PERSONA.short ?? "")) {
    push(
      "warn",
      slug,
      'PERSONA.short still contains "placeholder" — replace with the real purpose',
    );
  }
  if (!TOPICS.length) {
    push(
      "warn",
      slug,
      "TOPICS is empty — chatbot will refuse every content question until you add at least one topic",
    );
  }

  const ids = new Set<string>();
  for (const t of TOPICS) {
    if (!t.id?.trim()) push("error", slug, "topic with empty id");
    else if (ids.has(t.id)) push("error", slug, `duplicate topic id: ${t.id}`);
    else ids.add(t.id);
    if (!t.summary?.trim())
      push("warn", slug, `topic "${t.id}" has no summary`);
  }
}

if (!want || want === "sniro") await checkSniro();
if (!want || want === "de-vincho") await checkDeVincho();

const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
const infos = findings.filter((f) => f.level === "info");

if (!findings.length) {
  console.log("✓ content looks healthy");
  process.exit(0);
}

for (const group of [
  { label: "errors", items: errs, sym: "✗" },
  { label: "warnings", items: warns, sym: "!" },
  { label: "notes", items: infos, sym: "·" },
]) {
  if (!group.items.length) continue;
  console.log(`\n${group.label}:`);
  for (const f of group.items) console.log(`  ${group.sym} [${f.slug}] ${f.msg}`);
}

console.log();
console.log(
  `summary: ${errs.length} error(s), ${warns.length} warning(s), ${infos.length} note(s)`,
);
process.exit(errs.length ? 1 : 0);
