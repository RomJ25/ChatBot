// Print the composed system prompt + welcome message for a product, straight
// to stdout. Use this before shipping a content change to see exactly what
// the LLM will see.
//
// Usage:
//   bun scripts/prompt-preview.ts sniro
//   bun scripts/prompt-preview.ts de-vincho
//
// Also reports token/char counts so a hand-edit that accidentally exploded
// the prompt is visible.

import path from "node:path";

const VALID = new Set(["sniro", "de-vincho"]);
const slug = process.argv[2];
if (!slug || !VALID.has(slug)) {
  console.error(`usage: bun scripts/prompt-preview.ts <${[...VALID].join("|")}>`);
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dir, "..");
const base = path.join(repoRoot, "apps", slug, "src", "content");

// Rough token estimate: OpenAI's tiktoken rule of thumb is ~4 chars/token for
// English, ~2 for Hebrew (shorter subwords). We don't need exactness — just a
// signal that prompt size is healthy.
const estimateTokens = (s: string) => Math.ceil(s.length / 2.5);

let systemPrompt = "";
let welcome = "";

if (slug === "sniro") {
  const { buildSystemPrompt, buildWelcome } = await import(
    path.join(base, "systemPrompt.ts")
  );
  const { TEAM } = await import(path.join(base, "team.ts"));
  const { KNOWLEDGE } = await import(path.join(base, "knowledge.ts"));
  systemPrompt = buildSystemPrompt(TEAM, KNOWLEDGE);
  welcome = buildWelcome(TEAM);
} else {
  const { buildSystemPrompt, buildWelcome } = await import(
    path.join(base, "systemPrompt.ts")
  );
  const { PERSONA } = await import(path.join(base, "persona.ts"));
  const { TOPICS } = await import(path.join(base, "topics.ts"));
  systemPrompt = buildSystemPrompt(PERSONA, TOPICS);
  welcome = buildWelcome(PERSONA, TOPICS);
}

const bar = "─".repeat(64);
console.log(bar);
console.log(` ${slug} — composed system prompt`);
console.log(` ${systemPrompt.length} chars • ~${estimateTokens(systemPrompt)} tokens`);
console.log(bar);
console.log(systemPrompt);
console.log();
console.log(bar);
console.log(` ${slug} — welcome message`);
console.log(` ${welcome.length} chars • ~${estimateTokens(welcome)} tokens`);
console.log(bar);
console.log(welcome);
console.log();

// Signal nudges if the prompt is growing past what fits comfortably in a
// system-message slot on cheap/fast models. These are advisory — the app
// will still work above these thresholds, but the response latency and cost
// per turn scale with prompt size.
if (systemPrompt.length > 8000) {
  console.log(bar);
  console.log(
    " ⚠  prompt > 8 KB. Consider trimming knowledge items, or see",
  );
  console.log(
    "    doc/retrieval-decision.md for when retrieval starts to pay off.",
  );
  console.log(bar);
}
