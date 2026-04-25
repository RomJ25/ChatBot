# Why there's no retrieval layer (yet)

## Context

Each product in this workspace grounds its LLM answers in a hand-curated, structured knowledge base (`apps/<product>/src/content/`). At build time, the content is rendered into a Markdown **system prompt** that's sent verbatim with every chat request.

There is no embedding model, no vector store, and no retrieval step between the user's question and the LLM call. This is a deliberate choice.

## Today's size, concretely

Run `pnpm prompt:sniro` to see the current composed prompt. At the time of this note:

| Product | Prompt chars | ≈ Tokens |
|---|---|---|
| sniro | 1 996 | 799 |
| de-vincho | 490 | 196 |

Both fit comfortably in a single system message on any model. The full knowledge round-trips on every turn — cheap, deterministic, debuggable.

## Why no embeddings

At this scale, retrieval is pure overhead:

- **Complexity** — embedding model + vector store + retriever + reranker is a non-trivial second runtime.
- **Latency** — a retrieval step adds network hops before the first token.
- **Dependencies** — offline-first deployment (see `doc/standalone-binary.md`) gets harder the moment we need a sentence-transformers model bundled in.
- **Debuggability** — with a full prompt, you see exactly what the LLM saw. With retrieval, debug sessions turn into "did the right chunk come back?" instead of "was the fact in the prompt?".
- **Weak-model performance** — paradoxically, giving a weak model *more* context often makes it worse, not better, because retrieval errors compound. Our whole corpus in-context is better than a retrieved slice of it.

A well-crafted 2 KB system prompt outperforms a mid-quality RAG pipeline for corpora this size.

## Trip-wires for adding retrieval

Revisit this decision when any of these hits:

1. **Prompt > ~8 000 characters / ~3 000 tokens.** `pnpm prompt:<slug>` prints a warning at 8 KB. Above that, response latency and per-turn cost climb visibly on smaller models, and some providers (e.g. older OpenAI models, some Pollinations endpoints) start truncating system messages.
2. **More than ~50 knowledge items OR long-form (multi-paragraph) entries.** A hand-curated `KnowledgeItem[]` of ≤ 30 short items is fine; 50+ long entries turns the system prompt into haystack.
3. **External sources actually hook up.** `apps/<slug>/src/content/sources/external.ts` is the seam. When `sync-confluence` or similar starts pulling real pages, the corpus grows from hand-sized to drift-able. That's the natural time to add keyword search first, then embeddings only if keyword search under-recalls.
4. **Observed quality degradation.** Users ask specific questions and the model misses the relevant item even though it's in the prompt. That's the real signal — before that, retrieval is solving a problem nobody has.

## When we do add it

Start with the cheapest thing that works:

1. **Keyword / substring match** with a tiny BM25 or even a naive scorer across `KnowledgeItem.title + body`. Zero ML runtime, easy to debug.
2. **Top-K injection** — pick the best 5–10 items and render only those into the system prompt. Keep the full `commander + members + projects` skeleton always; retrieve only over the free-form `knowledge` entries.
3. **Upgrade to embeddings only if recall suffers.** A bge-small or MiniLM class model produces 384-dim vectors, embeds in the browser with ONNX Runtime Web or server-side in Bun, and fits a few hundred items in memory with no vector DB.

None of this is urgent. The content shape is already designed for it (`KnowledgeItem.id` is stable; `kind` groups by section; `source` is reserved for provenance). When the time comes, the seam exists.

## Quick commands

```
pnpm prompt:sniro        # preview the composed prompt + size
pnpm prompt:de-vincho
pnpm doctor              # flag placeholders, duplicates, missing descriptions
```
