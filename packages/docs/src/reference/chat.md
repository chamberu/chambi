# @chamvi/chat

Chat channels on the [Chat SDK](https://www.npmjs.com/package/chat), with WhatsApp Web on Baileys. The public API of `packages/chat/src/index.ts`, `src/baileys/index.ts` and `src/module/index.ts`.

```bash
npm install @chamvi/chat @chamvi/core @chamvi/http chat --save
npm install baileys@7.0.0-rc14 --save   # for @chamvi/chat/baileys only
```

`@chamvi/core`, `@chamvi/http` and `chat` (`^4.43.0`) are peer dependencies; `baileys` (exactly `7.0.0-rc14`, the version the adapter's identity rules were verified against) and `@chamvi/app` are optional peers. Only `@chamvi/chat/baileys` imports `baileys`, only `@chamvi/chat/module` imports `@chamvi/app`. See [WhatsApp](/deployment/whatsapp) for operating a WhatsApp connector.

## createWhatsAppChat

```ts
function createWhatsAppChat(options: WhatsAppChatOptions): WhatsAppChatSetup; // @chamvi/chat/baileys
// WhatsAppChatSetup = { chat, ingress, channel, status(): WhatsAppConnectionStatus }

const WHATSAPP_ADAPTER_NAME: 'whatsapp';
const WHATSAPP_RECONNECT: { initialMs: 2000; factor: 1.8; maxMs: 30_000; jitter: 0.25; maxAttempts: 12 };
const WHATSAPP_SHUTDOWN_TIMEOUT_MS: 30_000;
// error codes: 'whatsapp_auth', 'whatsapp_connection', 'whatsapp_logged_out' (WHATSAPP_*_ERROR_CODE)
```

<<< @/snippets/chat.ts#whatsapp

| Option | |
|---|---|
| `account` | Required. A non-secret alias of the account (the conversation account), not its phone number |
| `auth` | Required. An `IWhatsAppAuthProvider` (below); chamvi ships no production provider |
| `policy` | Required. `{ senders, groups?, requireGroupMention? }` or `{ open: true, groups?, requireGroupMention? }` (below) |
| `resolveInvoker(identity)` | Required. The invoker of an allowed message's runs; `undefined` denies the message |
| `state` | Required. The Chat SDK `StateAdapter` of the `Chat` |
| `approvalUrl(ref)` | Required. The approval link, `ref = { runId, approvalId, agent }` (ids only) |
| `onPairing({ qr })` | Required. Gets the QR reference to render while the account is not paired; never a log or `onError` |
| `name`, `untrusted`, `timeoutMs` | As for `chatChannel()` |
| `clock` | The connector's clock (backoff, shutdown bound); default the engine's |
| `onError` | Failures nobody awaits; default `console.error` |
| `logger`, `userName` | The Chat SDK logger (default level `warn`) and bot user name (default `chamvi`) |
| `socketOptions` | Further Baileys `SocketConfig` fields (`version`, `browser`, ...); `auth` and `logger` are chamvi's |
| `socketFactory` | Default Baileys' `makeWASocket`; tests pass a fake |

Throws `InvalidAgentDefinitionError` for a missing or malformed option. The factory acquires nothing and builds no socket; neither does `chamvi start --check`.

### Sender policy

Policy entries are normalized jids, never names: senders are phone number jids (`<digits>@s.whatsapp.net`, no device suffix), groups group jids (`<id>@g.us`). Errors name the option and index, never the value.

| Message | Starts runs when |
|---|---|
| Direct | The sender is listed (or `open`), and `resolveInvoker` names an invoker |
| Group | The group is listed, the participant is listed (or `open`), the bot is mentioned (unless `requireGroupMention: false`), and `resolveInvoker` names an invoker |

The identity (`WhatsAppIdentity { account, chat, sender, group, mentioned }`) is authenticated: the sender of a group message is its participant, never the group jid; a device suffix is removed; a LID sender resolves to a phone number only through the stanza's server-provided alternative (`participantAlt`/`remoteJidAlt`) or Baileys' LID mapping store, else the message is denied (an unresolved identity never inherits another's permissions). The bot's own messages are ignored. Denied messages are dropped silently: no run, no reply, no download.

### Auth provider

```ts
interface IWhatsAppAuthProvider {
    acquire(signal: AbortSignal): Promise<WhatsAppAuthLease>;
}
type WhatsAppAuthLease = {
    auth: AuthenticationState;     // Baileys creds and signal key store (get, set, clear?)
    saveCreds(): Promise<void>;    // persists auth.creds, serialized with key writes
    flush(): Promise<void>;        // resolves once every accepted write is durable
    release(): Promise<void>;      // gives the location up
};
```

`acquire` loads the session and takes its location exclusively (a second holder is refused; the start then fails before any socket). chamvi calls `saveCreds` and the key store only while the lease is in use: once the connection closes, every later call is refused (`InvalidRunStateError`). On stop it ends the socket (bounded by `WHATSAPP_SHUTDOWN_TIMEOUT_MS`), then waits for pending writes, `flush`es and `release`s, within a second `WHATSAPP_SHUTDOWN_TIMEOUT_MS` (no write is admitted after the close, so a dead link's end never eats into it); past it, or when `flush` fails, the lease is not released (fenced) and `whatsapp_auth` is reported. A lease that arrives after the stop is released at once.

### Connection

`status()`: `stopped`, `connecting`, `connected` (an `open` event), `disconnected`, `logged-out`, from Baileys' `connection.update` only. Sends go out only while `connected`. An unexpected close reconnects after `min(30 s, 2 s * 1.8^n)` ±25 % on the clock, at most 12 times in a row (reset by an open), then reports `whatsapp_connection` and stays disconnected. A logout (401) reports `whatsapp_logged_out` and a replacing session (440) `whatsapp_connection`; neither reconnects.

### Delivery

A send posts the raw text to the chat's jid with a message id derived from the send's key (`3EB0` + 36 hex of its SHA-256), so a retry reuses the id. Whether WhatsApp drops such a duplicate is not verified: delivery is at least once.

## chatChannel

```ts
function chatChannel(options: ChatChannelOptions): ChatChannel; // IChannel & { on(), to() }
function createChatIngressAdapter(adapter: Adapter): ChatIngress;

const CHAT_CHANNEL_NAME: 'chat';
const CHAT_TEXT_MAX_CHARS: 4096;          // UTF-16 code units
const CHAT_TIMEOUT_MS: 30_000;            // one send
const CHAT_BODY_LIMIT_BYTES: 1_048_576;   // one webhook body
const CHAT_WEBHOOK_TIMEOUT_MS: 30_000;    // waiting for the webhook's messages
const CHAT_STOP_TIMEOUT_MS: 30_000;       // waiting for messages being accepted at stop
const CHAT_REQUEST_ERROR_CODE: 'chat_request';
const CHAT_INTAKE_FAILED_ERROR_CODE: 'chat_intake_failed';
const CHAT_STOP_TIMEOUT_ERROR_CODE: 'chat_stop_timeout';
```

<<< @/snippets/chat.ts#generic

| Option | |
|---|---|
| `chat`, `adapters` | The `Chat` and its adapters, each wrapped by `createChatIngressAdapter()` and registered with that `Chat` under its name. The channel owns the `Chat` alone; another channel cannot take it |
| `allowMessage(incoming)` | Required for every adapter: whether a message may start runs at all |
| `resolveInvoker(incoming)` | The runs' invoker; none by default |
| `name` | Default `chat` (the agent name rule) |
| `webhooks` | Adapter names served at `POST /channels/<name>/<adapter>`; without any the channel has no `in` |
| `untrusted` | Default `true`: every run is tainted `channel:<name>` |
| `account` | The conversation account alias; default the adapter's name |
| `defaultAddress` | An address of `to()`; none by default (an ungated sink for tainted runs) |
| `connect({ signal, clock })`, `disconnect()` | Called on start (after the `Chat` initialized) and on stop; `connect` must settle once `signal` aborts |
| `approvalUrl(ref)` | Required to send an approval |
| `history` | Only `0`: no platform history is fetched |
| `timeoutMs` | One send's bound, default `CHAT_TIMEOUT_MS` |
| `onError` | Failures nobody awaits (refused and failed messages, stop) |

The wrapper replaces the SDK's `processMessage` on the `ChatInstance` it hands the adapter, so messages reach chamvi's intake instead of the SDK's handlers and its pre-handler deduplication (which would drop a redelivery after a failure). Actions (`processAction`) are not supported.

### Intake

Per message, in order: the bot's own messages are skipped; ids are checked (`ValidationError`, never echoing ids or text); `allowMessage` decides; a message with attachments or without text is refused (`ValidationError` to `onError`); `resolveInvoker`; then every agent with a matching subscription gets one run, through the engine's trusted conversation intake for an agent with `conversation`, else a plain dispatch. The idempotency key hashes channel, adapter, thread, sender and message id, so a redelivery dedupes per agent; a plain dispatch also gets a per-chat concurrency key. A transient failure (a store write) is retried after 1 s and 2 s; an agent already accepted is not dispatched again. What still fails is reported once as `chat_intake_failed`, naming channel, adapter and agents, never the text.

### Webhooks

`POST /channels/<name>/<adapter>` (only adapters in `webhooks`, else 404) reads the body up to `CHAT_BODY_LIMIT_BYTES` (413 above it, before the adapter runs) and hands the raw request to the adapter's `handleWebhook`, which verifies it (its 401 passes through). The answer waits for every message the adapter handed over in the request's async context until each is stored as runs, at most `CHAT_WEBHOOK_TIMEOUT_MS`; a message that could not be stored for a reason a redelivery may fix (a store failure, the channel not started or stopping), or the timeout, answers 503 so the platform redelivers. A message only refused (attachments, no text, invalid ids, no conversation identity, a denied conversation, a throwing filter) is reported once and gets the adapter's own answer: a redelivery would be refused again. An adapter that passes messages to a consumer running in another async context (started before the request) is not tracked: its own 2xx stands. GET challenge flows are not served. The mount is under the http app's general rate limit unless [`channelRateLimits`](/guide/http) names the channel.

### Subscriptions

```ts
chat.on(options?: ChatSubscriptionOptions): ChannelSubscription<ChatPayload>; // channel 'chat'
channel.on(options?), channel.to({ adapter, threadId }): string;
// ChatSubscriptionOptions = { adapter?, events?, id?, filter?, concurrencyMaxRuns? }
```

`events`: `direct`, `mention`, `message` (any other group message), default `DEFAULT_CHAT_EVENTS` `['direct', 'mention']`. `id` default `chat:<events>` (`chat:<adapter>:<events>` with an adapter). The payload, `ChatPayload { adapter, event, threadId, channelId, message: { id, text, author: { id, name? }, sentAt? } }`, holds no raw platform object. The run's address (`chat:` + base64url of `[adapter, threadId]`, at most 255 characters) is the chat.

### Outbound

`emit()` sends `title`, a blank line and `body`, refused above `CHAT_TEXT_MAX_CHARS` (no splitting). `approve()` sends the title and body (only this prose is cut, surrogate-safe), the options (`- <id>: <label>`, no detail), `Expires: <ISO>` and `Approve or deny: <approvalUrl>` (with options `Choose and approve or deny: <approvalUrl>`); the owner answers in the UI, there are no native buttons. `ChannelMessage.slot` is ignored: every message is a new chat message. A send is bounded by `timeoutMs`; a timeout fails with `chat_request` saying the message may still be delivered, a late completion is reported, and the engine's retry may send it again (at least once). A send while the channel is stopped or draining fails.

### Memory and trust

An agent with `conversation` is bound to `{ account, chat, audience }`: audience `direct:<author>` for a direct chat, `group:<channel>` for a group (one memory per group). It needs `IStore.conversations` and the engine's `conversations: { authorize }`; see [Conversation Memory](/guide/conversations). Runs are tainted by default, so `guardWhenTainted` tools ask for approval; replies to the source chat and the `defaultAddress` are exempt from the outbound gate (see [untrusted content](/guide/tools#untrusted-content-and-outbound-tools)).

<<< @/snippets/chat.ts#agent

## chatModule

```ts
function chatModule(options: { channel: ChatChannel }): IModule; // @chamvi/chat/module, name chamvi:channel:<name>
```

<<< @/snippets/chat.ts#module

Contributes the prebuilt channel to `AppToken.CHANNELS`; the engine starts and stops it, the http module mounts its `in`. No env variable, no start step; `start --check` neither initializes the `Chat` nor connects. A channel that is no `chatChannel()` is `InvalidAgentDefinitionError`.

## Not supported yet

Media (incoming attachments, outbound files), platform history, message splitting, native approval buttons and actions, phone-number pairing codes, a shipped production WhatsApp auth provider, multi-replica connector failover, lossless or offline WhatsApp ingestion, and verified webhook platforms beyond the generic adapter contract.
