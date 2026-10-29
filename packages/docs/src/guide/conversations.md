# Conversation Memory

Conversation memory gives an opted-in agent recent text and explicitly saved notes from the same chat across runs. It needs no embeddings or external search service. It is separate from a run's checkpoints and from agent-wide [state](/guide/state).

## Enable it explicitly

Enable both the app capability and `conversation: true` on the agent. A required `authorize` function decides whether the authenticated caller may dispatch to, recall from, or manage notes in that identity. Supply your own channel adapter and policy to this example:

<<< @/snippets/conversations.ts#app

`memoryTools()` supplies `memory_list`, `memory_get`, `memory_set` and `memory_remove`. Add them through the tools factory when `hasConversation(ctx)` is true. They are not automatically installed. Ordinary runs of the same agent still work without a conversation binding. Executing a memory tool outside a bound run fails validation.

Without `conversations`, the app creates no conversation store. Enabling the agent without the app capability is a configuration error. The default conversation store uses the same selected PostgreSQL DataSource as the run store. With no selected DataSource it uses `MemoryConversationStore` and warns: a process restart loses history and notes, and replicas do not share them. PostgreSQL is required for the default restart-durable production setup.

## Keep memory when renaming an agent

Use `conversation: { key: 'support' }` to give memory a stable identifier. Keep the same key when changing `name`. To retain history first created with `conversation: true`, use the previous agent name as the key. Channel, account, chat and audience must still match. A different key starts separate history; it does not copy or migrate the old history. Change a key only after draining existing turns: queued runs bound to its previous key fail safely.

The authorizer receives `access.agent` as the actual agent name and `access.identity.agent` as the memory key. Check permissions using the actual agent and authenticated caller. Choosing a key grants no access by itself. Operator identity arguments also use the memory key in their `agent` field. Deliberately giving multiple agents the same key shares their memory under the policy you provide.

## Trusted intake and two messages

A channel adapter must authenticate and normalize the incoming event before calling `dispatchConversation`. Scope is the exact tuple of memory key, channel, account alias, chat and explicit audience. The memory key defaults to the agent name. The engine derives its concurrency key; omit `concurrencyKey` unless it matches that canonical key. Use the adapter's stable event ID as the idempotency key. Within the existing idempotency reservation lifetime, duplicate delivery remains a duplicate after reset when its original run exists. A rare failed run creation can leave an idempotency reservation without a run. Generation-zero retries can heal it. After any reset or deletion, the engine cannot prove that reservation's original generation and refuses to heal it into current memory. It requires explicit operator recovery or reservation expiry; retrying the same event does not automatically recover it.

<<< @/snippets/conversations.ts#intake

Call `firstMessage` on a started engine. Stop the app normally, then start a new instance using the same PostgreSQL database and registered channel configuration. Call `nextMessage` on that new engine. Accepted prior input and confirmed replies are available as recent context; a `memory_set` note also survives the restart. The model chooses whether to call a tool, so explicit instructions and tool permissions still matter.

Use the exact registered channel object with `engine.channelContext(chat)`. Channel names supplied by arbitrary callers do not grant this capability. The adapter supplies accepted plain text explicitly; raw Chat SDK payloads or HTTP request bodies are not trusted identities. Ordinary `engine.dispatch()` and handoffs discard forged conversation bindings. Built-in HTTP intake does not enable conversation recall by accepting account/chat fields.

For a private chat, the policy should check the authenticated caller's access to the account and chat. For a group, choose an audience that represents the actual authorized membership or view, and recheck it when membership changes. Do not reuse a private audience for a group or infer authorization from a concurrency key. The policy runs before admission and again for recall/resume and memory-tool calls. A later denial cannot retract content already sent to providers or tools.

## What is remembered

Only accepted user text and ordinary messages emitted to the source channel and exact source address enter recent context. Emit with a tool such as `reply` above: returning final model text alone does not send or capture a reply. Approval notifications, other destinations, reasoning, tool results and attachments are not recalled as transcript messages.

A sent reply means `channel.out` resolved, not that a recipient read or received it. The journal records pending sends before calling the transport. If a crash leaves delivery uncertain, the item remains pending until reconciliation can mark it sent or unknown. Pending and unknown replies remain inspectable and stay out of future recall. External delivery still has an at-least-once crash window; use transport idempotency keys. On cancellation, an adapter that ignores its abort signal may still deliver late, but that late completion cannot write a successful framework receipt. An interrupted turn retains ownership for recovery, with the send pending until reconciliation.

Each run gets an immutable snapshot before its first model step. A resumed run keeps that snapshot. Notes appear as labeled untrusted user data before the selected transcript, never as system instructions. The current input remains last. There is no automatic memory extraction, summarization, semantic retrieval or transport-history backfill.

## Limits and retention

All limits count UTF-8 bytes, not tokens. They do not guarantee that a model context window can fit the selected input. Selection keeps whole records, chooses recent records first and renders them chronologically; oversized records can be omitted, with an omission count in the snapshot.

| Limit | Default | Maximum |
|---|---:|---:|
| Prior transcript items | 20 | 100 |
| Prior transcript bytes | 32,768 | 131,072 |
| Note context bytes | 8,192 | 32,768 |
| One accepted item, bytes | 16,384 | 65,536 |
| Transcript retention | 30 days | 365 days |
| Stored items per generation | 1,000 | 10,000 |

Configured limits must be positive integers. A note key holds 1–128 code units without controls; a note body holds at most 2,048 UTF-8 bytes. At most 100 live notes exist per scope; list requests return at most 50. Notes persist until removed unless given an expiry. Set/remove return metadata, and replay records retain no note body.

Expired notes disappear from reads; a new turn trims expired history. Explicit `engine.pruneConversations()` removes inactive retained data and settled note-operation replay records. The app adds no retention timer: arrange explicit pruning in your operator job. Active/recoverable replay records stay protected, and a settlement lookup failure retains records and surfaces the error.

## Operator management and deletion

These in-process APIs require possession of the engine. They are not model tools or public HTTP/UI routes:

<<< @/snippets/conversations.ts#management

Inspection of an unknown identity returns `undefined` and creates nothing. Reset advances the generation, invalidates queued old work and optionally keeps notes; it retains old transcript data until retention. Delete removes conversation-owned items, notes, snapshots and operation records while retaining a generation tombstone that prevents stale work from restoring them. Both refuse an active turn; terminal owner reconciliation must finish first.

Deletion is not erasure of every copy. Runs retain trigger/payload and conversation input, and checkpoints, effects, provider logs and backups have their own lifecycles. Removing a note clears its live body, but prior immutable snapshots and audit copies can still contain it.

## Store and shutdown lifecycle

Normal app migrations install conversation tables even when recall is disabled. `chamvi start --check` validates configuration and connects read-only: it creates no conversation identity and runs no migrations. Existing migration flags keep their ordinary behavior.

Pass `conversations: { authorize, store: customStore }` to use an `IConversationStore`. A custom store owns its schema, connection and shutdown lifecycle. The app does not initialize, migrate or close it. A replacement store module must register `AppToken.CONVERSATIONS` when the capability is enabled. With the built-in store module, an injected DataSource remains caller-owned, just as it does for run storage.

The existing app drain waits for engine executions and conversation journal/reconciliation writes before closing its owned DataSource. Run admission and conversation writes use separate stores and transactions: no cross-store atomicity is promised. Runs are created before conversation ownership is claimed, and restart reconciliation repairs terminal ownership safely.

## PostgreSQL records

Fixed fields use ordinary columns. Conversation-owned records reference their parent conversation with foreign keys. Only the frozen AI SDK messages need JSONB.

| Record | Purpose |
|---|---|
| Conversation | Identity, reset generation and current turn owner |
| Item | Accepted input or a reply with its delivery status |
| Note | Current explicitly saved text |
| Turn | Context frozen before the first model call, reused after a crash |
| Note operation | Metadata receipt committed atomically with a note edit, preventing duplicate edits on retry |

The turn record exists before a checkpoint can be written. The note receipt must commit in the same transaction as its edit. Existing checkpoints and effects cannot provide those guarantees across independently configured stores. Run and checkpoint bindings retain scalar provenance without foreign keys to the conversation store, which may use another backend.
