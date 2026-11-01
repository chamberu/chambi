# Knowledge

Knowledge gives an agent a large body of reference material (handbooks, docs, API references, release notes) without putting it into the model context. The agent searches it by meaning through the `knowledge_search` tool when a question needs it and gets back only a few relevant passages. It lives in the optional `@chamvi/knowledge` package.

## Knowledge, skills or conversation memory?

| | [Skills](/guide/skills) | Knowledge | [Conversation memory](/guide/conversations) |
|---|---|---|---|
| What | *How* to do something (procedures) | *What* is true (reference facts, documents) | *What was said* in one chat |
| Written by | Agent creator, reviewed and pinned | Agent creator, in code | Chat participants and the agent |
| Size | Small (16 skills, ~1 MiB) | Large (thousands of documents) | One chat |
| Found by | Name: listed, loaded whole | Meaning: searched, a few passages | Recalled automatically, in order |

**If the agent should follow it, it is a skill; if it should look it up, it is knowledge; if someone said it in this chat, it is conversation.**

Knowledge never adds system instructions: it reaches the model only as the result of a search the model chose to make. It never reads or writes conversation data, and conversation memory stays as it is.

## Declare collections

A collection is a named set of documents, fed by sources and bound to one embedding model. Declare the app's collections with `knowledgeModule()` from `@chamvi/knowledge/module`, and give each agent `knowledgeTools({ collections })` naming the ones it may search:

<<< @/snippets/knowledge.ts

```bash
npm install @chamvi/knowledge
```

Collections are declared at app level only; agent definitions, folder agents included, never declare one. Names follow the agent-name rule. A string model such as `'openai/text-embedding-3-small'` resolves through the app's [model providers](/guide/models) and their keys, like chat models; an AI SDK `EmbeddingModel` object is used as is. A name declared twice, a model that does not resolve or an invalid source (a `folder()` path that is no directory) fails the boot, and `chamvi start --check` reports it.

Without `repository` the vectors live in memory, which the module warns about outside dev: every restart re-embeds, and replicas index separately. A persistent repository (pgvector) is planned.

## Sources

- **`folder(path, { extensions?, trusted? })`**: every `.md`, `.markdown`, `.mdx` and `.txt` file below `path` (resolved against the working directory when called), in path order, dot entries skipped. The document id and source are the relative POSIX path, the title the first `# ` heading, else the file name. A symbolic link (to a file or a directory: never followed), a subdirectory that cannot be listed, a file over 1 MiB or a file that is not UTF-8 is reported through the app log and skipped; the rest of the collection indexes. A missing directory fails the boot.
- **`defineKnowledgeSource({ kind?, trusted?, check?, documents })`**: your own source. `documents({ signal, onError })` yields `{ id, content, title?, source?, metadata? }`. An item with an empty id, an id over 255 characters or with NUL, or content that is no string, is reported by its id (never its content) and skipped. An optional `check()` validates the source's configuration at the boot and in `start --check`; an `InvalidAgentDefinitionError` it (or `documents()`) throws is a configuration error: stored on the collection and logged once, never retried.

A document id is stable: yielding it again with new content replaces the document, so a re-run never duplicates. A document no source yields any more is deleted. When two sources yield the same id, the first is kept.

## Indexing

The module indexes once `chamvi start` is up, in the background: it never blocks the start or readiness. `run-job`, `start --check` and `migrate` never embed; a check only reads the store.

Documents are split into passages of at most 2000 characters: paragraphs are packed whole, a Markdown heading stays with the paragraph after it and consecutive passages overlap by about 200 characters. Passages are embedded through the AI SDK's `embedMany`, 64 per call. Each document's content hash is stored, so a restart with unchanged sources makes no embedding call and a changed file re-embeds that file only.

Each collection is indexed under the store lock `knowledge:<name>`, so one replica (or one process of several) indexes it while the others wait and stop once it is ready. A failed pass (a provider error, a rate limit, an unreadable source) is stored on the collection with the time of the next attempt, logged as `knowledge error` with the collection, and retried after 5 seconds, doubling up to 5 minutes per failure in a row. The backoff is stored, so it holds across replicas: however many replicas run, the provider sees one attempt per backoff step (a replica only skips it on its own first attempt after a start). An embedding call that does not answer within 60 seconds is given up and counts as a failure.

### Statuses and re-embedding

| Status | Meaning |
|---|---|
| `pending` | Never indexed yet: a search answers a tool error, `Knowledge collection "<name>" is not ready.` |
| `ready` | Indexed for the declared model and chunker. |
| `stale` | A re-embed is in progress; searches keep reading the previous generation while its model is still available (see below). |
| `orphaned` | The code no longer declares it: kept with its vectors, searchable by no agent. |

A collection serves one **generation** of passages, embedded by one model with one chunker version. When you change the model, the next generation is written while searches keep serving the current one; once it is complete the collection switches to it and the old generation is deleted. Vectors of two models never mix. A restart in the middle resumes the same generation; a generation abandoned for yet another model (or the previous one coming back) is deleted and its number is never used again.

Searching the previous generation needs the previous model to embed the query. A string model whose provider is still configured keeps working; an `EmbeddingModel` object the code no longer passes, or a string whose provider was removed, is gone, and a search answers the tool error `Knowledge collection "<name>" is being re-embedded; its previous model "<id>" is not available here, ...` until the new generation is complete. Keep the old provider configured until the re-embed finished if the collection must stay searchable throughout.

A collection fed by an untrusted source and then by trusted ones only stays untrusted until its documents were all replaced; a collection that becomes untrusted is untrusted at once.

A declared collection that disappears from the code is marked `orphaned`, never deleted, so a mistaken deploy loses no embeddings; declaring the name again picks it up. A replica that declares the name keeps serving it even when an older replica of a rolling deploy marked it orphaned. A declared name that the store holds as a managed collection fails the boot.

## The search tool

| Tool | Input | Result |
|---|---|---|
| `knowledge_search` | `{ query, collection?, topK? }` | `{ matches: [{ collection, document, index, text, score, title?, source? }], truncated }` |

`knowledgeTools({ collections, topK?, minScore? })` checks its options when called. The tool searches the named collections only: a call naming another collection, or an orphaned one, is refused without a search. The query is embedded once per model, and matches are ranked by cosine similarity across the collections searched: at most `topK` (default 5, at most 20), at most 20 000 characters in all (`truncated` when matches were left out), none below `minScore`. The tool description tells the model the passages are reference material, not instructions.

It is an ordinary tool: [tool policy and hooks](/guide/approvals) apply, its result is checkpointed, and a run resumed after an approval or a restart reads the recorded result instead of searching again.

## Untrusted content

Every collection has a `trusted` flag. `folder()` and custom sources are trusted by default: you wrote them and they ship with the code. A collection is trusted when all its sources are; `trusted` on a source or on `knowledgeCollection()` overrides it. A search over any untrusted collection [taints the run](/guide/tools#untrusted-content-and-outbound-tools) (`tool:knowledge_search`) before the passages reach the model, so later outbound tools marked `guardWhenTainted` ask for approval first.

This records provenance; it does not filter injected instructions out of the passages, which still reach the model.

## Without the app

`createKnowledge({ repository, locks, collections, models?, clock?, owner?, onError? })` builds the same thing over your own engine: `provideKnowledgeContext(engine, knowledge)` lets the tools reach it, `knowledge.start()` begins indexing and `knowledge.stop()` aborts and awaits it. The [package README](https://github.com/chamvi/chamvi/tree/master/packages/knowledge#usage) has a complete example.

## Not built yet

- **Managed collections**: collections created and filled through a REST API while the app runs (`knowledge:read`, `knowledge:write`), untrusted by default.
- **`@chamvi/store-db-vector`**: a pgvector repository with its own migrations.
- **More sources**: `git()` and `urls()` (untrusted by default), PDF documents, and per-agent `knowledge/` folders.
