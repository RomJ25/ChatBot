import type { KnowledgeItem, KnowledgeKind } from "./types";

/**
 * Join a Hebrew list with commas and a final "ו-" — e.g. "A, B ו-C".
 * Product-agnostic utility for prose composition.
 */
export function joinHebrewList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ו-${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ו-${items[items.length - 1]}`;
}

/**
 * Render a single knowledge item as Markdown.
 * Inline short one-line bodies; indent multi-line bodies under the title.
 */
export function renderKnowledgeItem(item: KnowledgeItem): string {
  const body = item.body.trim();
  const isOneLine = !body.includes("\n") && body.length < 120;
  if (isOneLine) {
    return `- **${item.title}** — ${body}`;
  }
  const indented = body
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
  return `- **${item.title}**\n${indented}`;
}

/**
 * Render knowledge items grouped by kind, each under a Hebrew header.
 * Empty kinds are omitted; if nothing is present, returns "".
 */
export function renderKnowledgeBlock(items: KnowledgeItem[]): string {
  if (!items.length) return "";

  const groups: { kind: KnowledgeKind; heading: string }[] = [
    { kind: "glossary", heading: "## מושגים" },
    { kind: "process", heading: "## תהליכים" },
    { kind: "faq", heading: "## שאלות נפוצות" },
    { kind: "link", heading: "## קישורים" },
    { kind: "note", heading: "## הערות" },
  ];

  const sections: string[] = [];
  for (const { kind, heading } of groups) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (!ofKind.length) continue;
    const lines = ofKind.map(renderKnowledgeItem).join("\n");
    sections.push(`${heading}\n${lines}`);
  }

  return sections.join("\n\n");
}
