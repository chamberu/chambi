# Chat SDK and Baileys reference

Inspected 2026-11-01 from the published npm packages installed in this repository (`node_modules`), not from a git checkout:

- `chat` 4.43.0 (vercel/chat; the plan names source commit `6300fe4d3050982f758b9ea8658d8011f8ca0ee8`, not re-read for this note), `dist/index.js` and the `dist/types-*.d.ts` chunk.
- `baileys` 7.0.0-rc14, `lib/index.d.ts` and the `lib/Types`, `lib/Utils`, `lib/WABinary` declarations (the public API), plus `lib/Socket/socket.js` for behaviour.
- History only: `chat-adapter-baileys` 2.1.0 (rama-adi/chat-adapter-baileys, MIT), no longer a dependency (see the last section).

Executable evidence: `packages/chat/test/unit/ingress/upstream.spec.ts` (tests named `native: ...` record upstream Chat SDK behaviour as it is) and `packages/chat/test/unit/baileys/*.spec.ts` (chamvi's adapter over a fake socket).

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

## Baileys 7.0.0-rc14 (public API chamvi's adapter uses)

| External file / function | chamvi counterpart | Behaviour / implication |
|---|---|---|
| `makeWASocket(config: UserFacingSocketConfig)` (`lib/Socket/index.js`) | `packages/chat/src/baileys/module.ts` (default `socketFactory`), `connection.ts:createSocket` | chamvi passes `auth` (the lease's creds plus the guarded key store) and a silent `logger`; the rest comes from `socketOptions`. `WhatsAppSocket` (`baileys/types.ts`) is the structural subset used (`ev.on/off`, `user`, `signalRepository.lidMapping`, `end`, `sendMessage`); `makeWASocket` is assignable to `WhatsAppSocketFactory` (pinned in `test/unit/baileys/module.spec.ts`). |
| `SocketConfig` has `waWebSocketUrl` but no WebSocket class/factory (`lib/Types/Socket.d.ts`) | `WhatsAppChatOptions.socketFactory` | Tests replace the whole socket factory (fake event emitter), never the transport: no Noise handshake is reproducible offline. |
| `makeSocket` wraps `authState.keys` with `addTransactionCapability(keys, ...)` (`lib/Socket/socket.js`) | `connection.ts:guardKeys` | Baileys only calls the documented `SignalKeyStore` `get`/`set`/`clear` of the store it is given and buffers transactions itself, so guarding those three is complete: after the generation ends each rejects (`InvalidRunStateError`). A provider's own `transaction` is not called. |
| `ev.emit('creds.update', ...)`; the socket itself `Object.assign`s the update into `authState.creds` | `connection.ts:onCreds` | chamvi calls `lease.saveCreds()` per update while the generation admits writes; tracked, awaited before `flush`. |
| `connection.update` `{ connection: 'open' \| 'connecting' \| 'close', lastDisconnect.error (Boom, output.statusCode), qr }` | `connection.ts:onUpdate` | Status comes from these events only. `qr` goes to `onPairing` only (no log: the Baileys logger is silent). |
| `DisconnectReason.loggedOut` (401), `connectionReplaced` (440) (`lib/Types/index.d.ts`) | `connection.ts:onClose` | 401: status `logged-out`, `whatsapp_logged_out`, no reconnect. 440: `disconnected`, `whatsapp_connection`, no reconnect (one connector per account). Any other close: backoff reconnect (`WHATSAPP_RECONNECT`) on the injected clock. |
| `messages.upsert { messages, type }` | `adapter.ts:handle` | Only `type === 'notify'`; content through `normalizeMessageContent`; text from `conversation`/`extendedTextMessage.text`/media caption; media kinds become `Attachment`s without data (the intake refuses them). |
| `WAMessageKey { remoteJid, participant, participantAlt, remoteJidAlt, fromMe }` | `policy.ts:resolveIdentity` | Sender = `participant` in a group (never the group jid), else `remoteJid`. A `@lid` sender resolves only through `participantAlt`/`remoteJidAlt` (server-provided) or `signalRepository.lidMapping.getPNForLID()`, else it is denied. |
| `jidNormalizedUser`, `isPnUser`, `isLidUser`, `isJidGroup`, `areJidsSameUser` (`lib/WABinary/jid-utils.d.ts`) | `policy.ts`, `adapter.ts` | Device suffixes are removed with `jidNormalizedUser`; policy entries must already be normalized. Mentions compare `contextInfo.mentionedJid` with `user.id`/`lid`/`phoneNumber` by `areJidsSameUser`. |
| `sendMessage(jid, content, { messageId })` (`MinimalRelayOptions.messageId`, "override the message ID") | `module.ts:messageIdOf` | chamvi derives `3EB0` + 36 upper hex of sha256(channel, message key), so a retry reuses the id. Whether WhatsApp drops a duplicate id is unverified: delivery stays at least once. |

## History: chat-adapter-baileys 2.1.0 (Task 1, removed)

Task 1 found the adapter lacked every seam the WhatsApp task needed; the owner chose a chamvi-owned adapter on Baileys' public API (2026-11-01), and the package was removed from every dependency field. Findings, for reference ("pinned" refers to Task 1 specs removed with the dependency):

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

### Baileys transport observation (Task 1)

| External file / function | chamvi counterpart | Behaviour / implication |
|---|---|---|
| `makeWASocket(config)` (`lib/Socket/socket.js`, `new WebSocketClient(url, config)`) | none | `SocketConfig` has `waWebSocketUrl` but no WebSocket class/factory: a test can only point the socket at a loopback URL, which never completes the Noise handshake, so `open`, a `loggedOut` close, pairing and sends cannot be produced without WhatsApp. |
| `ws.on('error' | 'close')` -> `end(error)` | none | A dropped transport emits `connection.update { connection: 'close' }` with a non-loggedOut status code, which the adapter reconnects on. |
