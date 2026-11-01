# Chat SDK and chat-adapter-baileys reference

Inspected 2026-11-01 from the published npm packages installed in this repository (`node_modules`), not from a git checkout:

- `chat` 4.43.0 (vercel/chat; the plan names source commit `6300fe4d3050982f758b9ea8658d8011f8ca0ee8`, not re-read for this note), `dist/index.js` and the `dist/types-*.d.ts` chunk.
- `chat-adapter-baileys` 2.1.0 (rama-adi/chat-adapter-baileys, MIT), `dist/index.js` and `dist/index.d.ts`. Peer `chat ^4.24.0`, dependency `baileys >=7.0.0-rc13 <8`.
- `baileys` 7.0.0-rc14, `lib/Socket/socket.js`, `lib/Types/Socket.d.ts`.

Executable evidence: `packages/chat/test/unit/ingress/upstream.spec.ts` (tests named `native: ...` record upstream behaviour as it is).

## Chat SDK (`chat` 4.43.0)

| External file / function | chamvi counterpart | Behaviour / implication (4.43.0) |
|---|---|---|
| `Chat.processMessage(adapter, threadId, messageOrFactory, options)` (`dist/index.js`) | `packages/chat/src/ingress/module.ts:createChatIngressAdapter` (facade `processMessage`) | Returns the task promise; attaches its own `.catch` that logs `Message processing error`, so an ignored task is no unhandled rejection. With `options.deduplicate === false` it skips the dedupe; adapters do not pass it. |
| `Chat.routeIncomingMessage` | none (bypassed) | Skips `author.isMe`, then `state.setIfNotExists('dedupe:<adapter>:<message id>', ttl)` **before** any handler. A handler failure leaves the key: a redelivery of the same message id never reaches a handler again (pinned: `native: a handler failure after the pre-handler dedupe drops the redelivery`). Chamvi intake therefore never runs behind the SDK dedupe. |
| `Chat.handleConcurrent` / `dispatchToHandlers` | none | With `concurrency: 'concurrent'` (and no `maxConcurrent`) handlers run in parallel and `processMessage` settles after them. |
| `Chat.doInitialize` -> `adapter.initialize(this)` (public `Adapter.initialize(chat: ChatInstance)`) | `createChatIngressAdapter`: `initialize(chat)` hands the wrapped adapter a `Proxy` facade of the real chat, `processMessage` replaced, every other member read from (and functions bound to) the real chat | The interception seam: public, typed, no private field or prototype patch. `getAdapter(name)` returns the registered wrapper. |
| `Chat.shutdown()` | channel stop (later task) | Calls `adapter.disconnect()` of every registered adapter (through the wrapper, bound to the real adapter), then `state.disconnect()`. |
| `ChatConfig` | `chatChannel()` construction (later task) | `userName` and `state` are required (the plan's sample construction omits `userName`). The main package ships no in-memory `StateAdapter`; tests use `packages/chat/test/utils/chat.ts:createMemoryState`. |
| `Adapter.reply?(threadId, messageId, message)`, called by `ThreadImpl.reply()` (`dist/chunk-*.js`) | none | New in the 4.4x line; conflicts with chat-adapter-baileys 2.1.0 (below). |

## chat-adapter-baileys 2.1.0

| External file / function | chamvi counterpart | Behaviour / implication |
|---|---|---|
| `createBaileysAdapter(config)` / `BaileysAdapterConfig` | `/baileys` entry (Task 6) | Options: `adapterName`, `auth { state, saveCreds }`, `version`, `userName`, `logger`, `onQR`, `phoneNumber` + `onPairingCode`, `socketOptions` (spread into `makeWASocket` after `version`/`auth`), `pollTtlMs`. No transport/socket factory, no reconnect delay, no abort signal, no status or logged-out callback. |
| `BaileysAdapter.initialize(chat)` | ingress facade | Stores the chat and replaces the configured logger with `chat.getLogger('baileys')`. |
| `connect()` -> `_createSocket()` (private) | Task 6 lifecycle | Calls the module-level `makeWASocket` import (`baileys`); without `version` it first fetches `fetchLatestBaileysVersion()` over the network. Resolves once the socket object exists, before any transport opened (pinned). |
| `connection.update` handling inside `_createSocket` | Task 6 status | `open` sets private `_isConnected`; `close` reconnects **immediately** (`await this._createSocket()`, no delay, no backoff, no abort) unless `disconnect()` ran or the status code is `DisconnectReason.loggedOut`. Logged-out and every state change surface only as logger text (`Connected to WhatsApp`, `Connection closed (code=<n>, reconnect=<bool>)`, `Logged out — not reconnecting.`). Pinned over a loopback transport: at least 5 attempts within milliseconds. |
| `disconnect()` | Task 6 stop | Sets private `_shouldReconnect = false`, ends the socket: no further reconnects (pinned). The version fetch before `makeWASocket` is not cancelled: a `disconnect()` during it still creates a socket afterwards (by reading; not pinned, a test would need the network). |
| `botUserId` getter | Task 6 identity | `socket.user.id`, `undefined` before pairing/open. The only public socket-derived field. |
| `postMessage(threadId, message)` -> `_sendPostable` -> `_sendOne` (private) | outbound (Task 4/6) | Message id generated inside `_sendOne` (`generateMessageIDV2`), `options.messageId` reachable only through private `_sendPostable`; `postMessage` takes no id (type pinned). The sent id comes back as `RawMessage.id` only after the send. |
| `reply(message, content)` | none | Signature differs from chat 4.43.0's `Adapter.reply(threadId, messageId, message)`: `BaileysAdapter` is not assignable to `Adapter` (type pinned) and the SDK call shape fails with a `TypeError` (pinned). Wrapping needs a cast, and `Thread.reply()` must never be used with this adapter. |
| `parseMessage(raw)` | intake (Task 3/6) | Sender id: the paired account for `fromMe`, else `key.participant` in a group, else the chat JID; no phone/LID resolution. `author.isMe`/`isBot` only for ids the adapter sent within 5 minutes (`SENT_MESSAGE_TTL_MS`). |
| `messages.upsert` handling | ingress facade | Only `type === 'notify'`; reactions go to `processReaction`, poll votes to `processMessage` with the option names as text, every other message to `chat.processMessage(this, threadId, async () => parseMessage(msg))` without awaiting or catching its promise. |
| `encodeThreadId` / `decodeThreadId` | address codec (Task 2) | `<adapterName>:<base64url(jid)>`; `adapterName` must not contain `:`. |

## Baileys 7.0.0-rc14

| External file / function | chamvi counterpart | Behaviour / implication |
|---|---|---|
| `makeWASocket(config)` (`lib/Socket/socket.js`, `new WebSocketClient(url, config)`) | none | `SocketConfig` has `waWebSocketUrl` but no WebSocket class/factory: a test can only point the socket at a loopback URL, which never completes the Noise handshake, so `open`, a `loggedOut` close, pairing and sends cannot be produced without WhatsApp. |
| `ws.on('error' | 'close')` -> `end(error)` | none | A dropped transport emits `connection.update { connection: 'close' }` with a non-loggedOut status code, which the adapter reconnects on. |
