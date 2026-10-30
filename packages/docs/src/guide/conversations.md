# Conversation Memory

Conversation memory gives an opted-in agent recent text and explicitly saved notes from the same chat across runs. It needs no embeddings or external search service. It is separate from a run's checkpoints and from agent-wide [state](/guide/state).

## Enable it explicitly

Enable both the app capability and `conversation: true` on the agent. A required `authorize` function decides whether the authenticated caller may dispatch to, recall from, or manage notes in that identity. Supply your own channel adapter and policy to this example:

<<< @/snippets/conversations.ts#app

`memoryTools()` supplies `memory_list`, `memory_get`, `memory_set` and `memory_remove`. Add them through the tools factory when `hasConversation(ctx)` is true. They are not automatically installed. Ordinary runs of the same agent still work without a conversation binding. Executing a memory tool outside a bound run fails validation.

Without `conversations`, the app creates no conversation store. Enabling the agent without the app capability is a configuration error. The default conversation store uses the same selected PostgreSQL DataSource as the run store. With no selected DataSource it uses `MemoryConversationRepository` and warns: a process restart loses history and notes, and replicas do not share them. PostgreSQL is required for the default restart-durable production setup.

## Keep memory when renaming an agent

Use `conversation: { key: 'support' }` to give memory a stable identifier. Keep the same key when changing `name`. To retain history first created with `conversation: true`, use the previous agent name as the key. Channel, account, chat and audience must still match. A different key starts separate history; it does not copy or migrate the old history. Before renaming an agent or changing its key, finish or explicitly cancel its queued, waiting and interrupted runs. The stable key preserves memory; existing runs retain their original agent name and are not reassigned. Queued runs bound to a changed key fail safely.

The authorizer receives `access.agent` as the actual agent name and `access.identity.agent` as the memory key. Check permissions using the actual agent and authenticated caller. Choosing a key grants no access by itself. Operator identity arguments also use the memory key in their `agent` field. Deliberately giving multiple agents the same key shares their memory under the policy you provide.

## Trusted intake and two messages

A channel adapter must authenticate and normalize the incoming event before calling `dispatchConversation`. Scope is the exact tuple of memory key, channel, account alias, chat and explicit audience. The memory key defaults to the agent name. The engine derives its concurrency key; omit `concurrencyKey` unless it matches that canonical key. Use the adapter's stable event ID as the idempotency key. Within the existing idempotency reservation lifetime, duplicate delivery remains a duplicate after reset when its original run exists. A rare failed run creation can leave an idempotency reservation without a run. Generation-zero retries can heal it. After any reset or deletion, the engine cannot prove that reservation's original generation and refuses to heal it into current memory. It requires explicit operator recovery or reservation expiry; retrying the same event does not automatically recover it.

<<< @/snippets/conversations.ts#intake

Call `firstMessage` on a started engine. Stop the app normally, then start a new instance using the same PostgreSQL database and registered channel configuration. Call `nextMessage` on that new engine. Accepted prior input and confirmed replies are available as recent context; a `memory_set` note also survives the restart. The model chooses whether to call a tool, so explicit instructions and tool permissions still matter.

Use the exact registered channel object with `engine.channelContext(chat)`. Channel names supplied by arbitrary callers do not grant this capability. Bound runs send the accepted `text` as the current user message, with their attachments. The original event payload remains available to tools and audit records. The adapter supplies accepted plain text explicitly; raw Chat SDK payloads or HTTP request bodies are not trusted identities. Ordinary `engine.dispatch()` and handoffs discard forged conversation bindings. Built-in HTTP intake does not enable conversation recall by accepting account/chat fields.

For a private chat, the policy should check the authenticated caller's access to the account and chat. For a group, choose an audience that represents the actual authorized membership or view, and recheck it when membership changes. Do not reuse a private audience for a group or infer authorization from a concurrency key. The policy runs before admission and again for recall/resume and memory-tool calls. A later denial cannot retract content already sent to providers or tools.

## What is remembered

Only accepted user text and ordinary messages emitted to the source channel and exact source address enter recent context. Emit with a tool such as `reply` above: returning final model text alone does not send or capture a reply. Approval notifications, other destinations, reasoning, tool results and attachments are not recalled as transcript messages.

A sent reply means `channel.out` resolved, not that a recipient read or received it. The journal records pending sends before calling the transport. If a crash leaves delivery uncertain, the item remains pending until reconciliation can mark it sent or unknown. Pending and unknown replies remain inspectable and stay out of future recall. External delivery still has an at-least-once crash window; use transport idempotency keys. On cancellation, an adapter that ignores its abort signal may still deliver late, but that late completion cannot write a successful framework receipt. An interrupted turn retains ownership for recovery, with the send pending until reconciliation.

Each run gets an immutable snapshot before its first model step. A resumed run keeps that snapshot. Notes appear as labeled untrusted user data before the selected transcript, never as system instructions. The current input remains last. There is no automatic memory extraction, summarization, semantic retrieval or transport-history backfill.

## Limits and retention

`maxItems` and `maxStoredItems` count items; `retentionMs` counts milliseconds. The byte limits (`maxHistoryBytes`, `maxNotesBytes` and `maxItemBytes`) count UTF-8 bytes, not tokens. These limits do not guarantee that a model context window can fit the selected input. Selection keeps whole records, chooses recent records first and renders them chronologically; oversized records can be omitted, with an omission count in the snapshot.

| Limit | Default | Maximum |
|---|---:|---:|
| Prior transcript items | 20 | 100 |
| Prior transcript bytes | 32,768 | 131,072 |
| Note context bytes | 8,192 | 32,768 |
| One accepted item, bytes | 16,384 | 65,536 |
| Transcript retention | 30 days | 365 days |
| Stored items per generation | 1,000 | 10,000 |

`maxStoredItems` is enforced during admission and explicit pruning. Active turn records remain protected; a large settled turn can remain above this cap until the next admission or prune. Recall has its own item and byte bounds.

Configured limits must be positive integers. A note key holds 1–128 code units without controls; a note body holds at most 2,048 UTF-8 bytes. At most 100 live notes exist per scope; list requests return at most 50. Notes persist until removed unless given an expiry. Set/remove return metadata, and replay records retain no note body.

Expired notes disappear from reads; a new turn trims expired history. Explicit `engine.pruneConversations()` removes inactive retained data and settled note-operation replay records. The app adds no retention timer: arrange explicit pruning in your operator job. Active/recoverable replay records stay protected, and a settlement lookup failure retains records and surfaces the error.

## Operator management and deletion

These in-process APIs require possession of the engine. They are not model tools or public HTTP/UI routes:

<<< @/snippets/conversations.ts#management

Inspection of an unknown identity returns `undefined` and creates nothing. Reset advances the generation, invalidates queued old work and optionally keeps notes; it retains old transcript data until retention. Delete removes conversation-owned items, notes and operation records, and clears its active snapshot while retaining a generation tombstone that prevents stale work from restoring them. Both refuse an active turn; terminal owner reconciliation must finish first.

Deletion is not erasure of every copy. Runs retain trigger/payload and conversation input, and checkpoints, effects, provider logs and backups have their own lifecycles. Removing a note clears its live body, but prior immutable snapshots and audit copies can still contain it.

## Repository and shutdown lifecycle

Normal app migrations install conversation tables even when recall is disabled. `chamvi start --check` validates configuration and connects read-only: it creates no conversation identity and runs no migrations. Existing migration flags keep their ordinary behavior.

Conversation policy lives in `conversations: { authorize, limits? }`; storage lives in `store.conversations`. For an app, pass custom capabilities through `storeModule({ store })`, or register the aggregate as `AppToken.STORE` in a replacement store module. Repository adapters reuse `@chamvi/core/conversation/persistence` for canonical identity validation, hashing and recall selection. A custom store owns its schema, connection and shutdown lifecycle. All built-in TypeORM roles, including conversations, must use the same DataSource; mixing the relational conversation store with another backend is unsupported. With the built-in store module, an injected DataSource remains caller-owned.

The existing app drain waits for engine executions and conversation journal/reconciliation writes before closing its owned DataSource. With the built-in PostgreSQL store, run and conversation records must share the same database. Their foreign keys enforce this relationship. Admission and conversation writes still use separate transactions; no cross-transaction atomicity is promised. Runs are created before conversation ownership is claimed, and restart reconciliation repairs terminal ownership safely.

## PostgreSQL records

Fixed fields use ordinary columns. Conversation-owned records reference their parent conversation with foreign keys. Only the frozen AI SDK messages need JSONB. The active snapshot lives on its conversation row and is cleared atomically when the turn ends.

| Record | Purpose |
|---|---|
| Conversation | Identity, reset generation, current turn owner and its frozen context |
| Item | Accepted input or a reply with its delivery status |
| Note | Current explicitly saved text |
| Note operation | Metadata receipt committed atomically with a note edit, preventing duplicate edits on retry |

The active snapshot exists before a checkpoint can be written. Waiting and interrupted runs retain it; terminal settlement clears it. An ended run cannot request historical snapshot replay. The note receipt must commit in the same transaction as its edit. Existing checkpoints are written after model steps, and generic effects are not committed atomically with note edits. Run and checkpoint bindings retain scalar scope provenance with foreign keys to the local conversation row. The checkpoint's existing run ID identifies its source run; no duplicate snapshot run ID is stored.
