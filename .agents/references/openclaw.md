# OpenClaw reference

Public source reference, inspected 2026-10-28. Pin: tag `v2026.10.5`, commit `1b58cb9a1b4f4353e1add63c8506db4d890962e8`. Source behavior is not evidence of any deployment's current configuration or storage contents. No private state was inspected.

Base source URL: https://github.com/openclaw/openclaw/tree/1b58cb9a1b4f4353e1add63c8506db4d890962e8

## Conversation context and memory

| External path / anchor | chamvi counterpart | Difference / implication |
|---|---|---|
| `docs/reference/session-management-compaction/store.md`, Two persistence layers | `packages/core/src/engine/execute/module.ts:70–72`, `packages/core/src/store/types.ts` | OpenClaw persists session rows and tree-structured transcript events in per-agent SQLite. chamvi checkpoints are per run; a new run starts from its triggering message, not automatically another run's transcript. |
| Same document, JSONL/session migration discussion | No migration counterpart | At this version, legacy `sessions.json` and JSONL are migration/archive artifacts, not the active runtime transcript store. Do not prescribe copying JSONL as a complete live-state migration. The document's path examples name `agent/openclaw-agent.sqlite`; verify actual path resolution before any separately authorized migration rather than assuming a database basename. |
| `docs/concepts/context.md`, `compaction.md`, `session-pruning.md` | Local plan 024 / issue #84; execute checkpoint messages | Stored transcript, bounded model context and compaction are separate mechanisms. Compaction does not by itself implement long-lived curated memory. |
| `docs/concepts/memory.md` | `packages/core/src/state/`, prospective scoped memory capability | OpenClaw uses curated `MEMORY.md`, optional `USER.md` and dated memory notes, separate from exhaustive transcripts. Existing agent-scoped chamvi state is not automatically a per-person access boundary. |
| `docs/concepts/memory-builtin.md`, What it provides / indexing | No shipped chamvi conversation retrieval implementation | OpenClaw offers keyword/FTS5 retrieval as well as embeddings/vector search. It documents chunks of 400 tokens with 80-token overlap. These are reference defaults, not proposed chamvi constants; embeddings are not a prerequisite for persistent useful context. |
| `src/routing/session-key.ts`, `buildAgentPeerSessionKey` | Current trigger channel/address/invoker; future trusted conversation scope | OpenClaw supports main and per-peer/channel/account DM scopes. Do not copy a personal-agent shared-main default into multi-user chat isolation. Groups and private DM memory need explicit separate policies. |
| `src/plugins/memory-audience.ts`, `memory-provider-types.ts`; `packages/memory-host-sdk/src/host/config-utils.ts` | Future recall authorization, not existing permission matcher behavior | OpenClaw distinguishes owner-private and conversation audiences and restricts cross-conversation defaults when isolation is configured. These runtime/prompt policies are not physical per-person database tenancy. |
| `extensions/memory-core/package.json` | No dependency added | Manifest declares `@openclaw/memory-core` private and peers on the OpenClaw host. This is not a drop-in independent memory library for chamvi. Do not infer npm availability from the package name. |

### Direct verification notes

Read-only `gh api` excerpts independently confirmed session-row/transcript SQLite authority, legacy-file caveats, FTS5/optional-vector documentation and the memory-core private manifest. Other path mappings were located by delegated source research. Resolve exact APIs and paths again before implementation or migration. No OpenClaw runtime/source has been imported into chamvi.

## Integration boundary

The existing `packages/channel-openclaw/src/channel/module.ts` sends requests to an OpenClaw host; it does not supply chamvi-owned conversational context. Replacing that transport path does not migrate assistant memories or runtime state. Keep operational migration notes local and require separate authorization for private source data access, pairing, sends or service changes.
