# WhatsApp

[`@chamvi/chat/baileys`](/reference/chat#createwhatsappchat) connects an agent to a WhatsApp account through WhatsApp Web, using [Baileys](https://www.npmjs.com/package/baileys) `7.0.0-rc14`. The account appears as a linked device; messages from allowed senders start runs, and tools reply in the same chat.

::: danger Unofficial protocol
WhatsApp Web through Baileys is not an official WhatsApp API. WhatsApp can change the protocol, and it can restrict or ban an account that automates it. Use an account you can afford to lose, keep the volume personal, and keep a way back (your previous setup) until the connector has run for a while.
:::

## Readiness checklist

Before a live cutover:

1. **A maintained auth provider.** chamvi ships no production session store. Your `IWhatsAppAuthProvider` must persist the creds and every signal key write atomically (a crash never leaves a half-written file), serialize writes, keep the session secret (it is the account), and take the location exclusively: `acquire` refuses while another holder has it. Test it against restarts before going live; Baileys' `useMultiFileAuthState` alone is not that.
2. **One connector.** One deployment per account, `Recreate` (stop, then start), one replica. Two processes on one session replace each other (440) and can corrupt the signal state. The `agent-app` chart's Recreate strategy fits.
3. **The sender policy.** List phone number jids and group jids explicitly; `{ open: true }` lets anyone write, with `resolveInvoker` as the only gate.
4. **An approval URL** into the chamvi UI, and an owner principal that can answer there. Approvals are answered in the UI only.
5. **Memory**, if the agent uses `conversation: true`: a store with conversations (PostgreSQL through `@chamvi/store-db` for restart-durable memory) and a `conversations.authorize` policy. A group is one memory (`group:<group jid>`), shared by its members.
6. **Trust.** Runs are tainted by default: tools marked `guardWhenTainted` need approval. Replies to the source chat are not gated; do not set a `defaultAddress` unless that chat may receive whatever a tainted run produces.

## Pairing

The first start of an unpaired session emits a QR reference to `onPairing` (it rotates periodically until scanned: Baileys shows the first for 60 s, each later one for 20 s). Render it for the phone (WhatsApp, Linked devices, Link a device); never log it. There is no phone-number pairing code yet. Once paired, the provider persists the creds and later starts connect without a QR.

## Connection and recovery

| Event | What happens |
|---|---|
| Unexpected close (network, server restart) | Reconnects with backoff on the clock: 2 s growing by 1.8 to 30 s, ±25 %, 12 attempts in a row, then `whatsapp_connection` and it stays disconnected until the channel restarts |
| Logout (401: the device was removed on the phone) | Status `logged-out`, `whatsapp_logged_out`, no reconnect. Pair again (a fresh session from the provider), then restart. The lease stays held until the channel stops |
| Replaced (440: another client took the session) | `whatsapp_connection`, no reconnect: stop the other connector first |
| Stop | Ends the socket (at most 30 s), refuses later auth writes, then waits for pending ones and flushes the lease, then releases it, within another 30 s; past those, or when the flush fails, the lease stays held and `whatsapp_auth` is reported. A dead link that holds the socket's end for its 30 s does not keep the lease |

A stop takes at most the socket's end (30 s) and the auth settling (30 s), plus the channel's wait for messages still being accepted (`CHAT_STOP_TIMEOUT_MS`, 30 s) and the Chat's shutdown. Only when every phase runs to its bound does that reach the CLI's 90 s force exit (`CHAMVI_FORCE_EXIT_MS`), which the chart's 120 s termination grace covers; raise `CHAMVI_FORCE_EXIT_MS` (below the grace) if a stop must never be cut short.

`setup.status()` reports the connection (`connected` only after Baileys' `open`); poll it for a readiness signal. Sends fail while it is not `connected`.

Baileys' own logger is silent, because its lines carry pairing material and session details; this also hides its decrypt and LID warnings. Errors reach `onError` without message text.

## What is not guaranteed

- **No lossless or offline ingestion.** A message that arrives while the connector is down, or that the process loses before it is stored as runs, is not fetched later. Platform history is not read.
- **Stop during a decrypt.** A message whose signal key commit arrives after the stop refused auth writes is not processed; Baileys may retry the commit for about 30 s, refused each time.
- **At least once delivery.** A send that times out (30 s) may still be delivered; the retry reuses the message id, but whether WhatsApp drops the duplicate is unverified.
- **Text only.** Messages with media are refused (reported, no run); replies are text up to 4096 characters, never split.
