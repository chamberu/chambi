<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/chat" width="128" height="128" />
</p>

<h1 align="center">@chamvi/chat</h1>

<p align="center">
    <b>Chat channels for chamvi agents.</b><br>
    Chat SDK adapters start runs and get replies through one channel,<br>
    and WhatsApp Web on Baileys ships as an optional entry.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/chat"><img src="https://img.shields.io/npm/v/@chamvi/chat" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/chat/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/chat" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage: WhatsApp](#usage-whatsapp)
- [Other Chat SDK adapters](#other-chat-sdk-adapters)
- [Subscriptions and replies](#subscriptions-and-replies)
- [Memory](#memory)
- [Trust](#trust)
- [Limits](#limits)
- [WhatsApp operations](#whatsapp-operations)
- [With @chamvi/app](#with-chamviapp)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/chat @chamvi/core @chamvi/http chat --save
# for WhatsApp Web
npm install baileys@7.0.0-rc14 --save
```

ESM only, Node.js `>=24.3.0`. `@chamvi/core`, `@chamvi/http` (the webhook body reader) and [`chat`](https://www.npmjs.com/package/chat) (the Chat SDK, 4.43 or later in the 4.x line) are peer dependencies; `smob` is the only runtime dependency. `baileys` is an optional peer dependency, pinned to the one version chamvi's WhatsApp adapter was verified against (`7.0.0-rc14`); only the `@chamvi/chat/baileys` entry imports it. `@chamvi/app` is an optional peer of `@chamvi/chat/module`.

| Entry | Holds |
|---|---|
| `@chamvi/chat` | `chatChannel()`, `createChatIngressAdapter()`, `chat.on()`/`chat.to()`, the limits and error codes |
| `@chamvi/chat/baileys` | `createWhatsAppChat()`: a chamvi-owned Chat SDK adapter on Baileys' public API, its connection, sender policy and auth lease |
| `@chamvi/chat/module` | `chatModule()`, which contributes a prebuilt channel to a `@chamvi/app` app |

## Usage: WhatsApp

`createWhatsAppChat()` builds a Chat SDK `Chat`, the WhatsApp adapter and its `chatChannel()`. Register the channel on the engine, subscribe an agent with `channel.on()` and reply from a tool with `ctx.channels.findOneOrFail('chat').emit()`:

```typescript
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { IEngine } from '@chamvi/core';
import { createWhatsAppChat } from '@chamvi/chat/baileys';
import type { WhatsAppChatOptions } from '@chamvi/chat/baileys';

export function createWhatsAppEngine(
    model: LanguageModel,
    // auth: your secure session store; state: a Chat SDK state adapter
    options: Pick<WhatsAppChatOptions, 'auth' | 'state' | 'onPairing' | 'socketFactory' | 'clock'>,
): IEngine {
    const { WHATSAPP_SENDERS, APP_URL } = process.env;

    if (!WHATSAPP_SENDERS || !APP_URL) {
        throw new Error('Set WHATSAPP_SENDERS (phone number jids, comma separated) and APP_URL.');
    }

    const whatsapp = createWhatsAppChat({
        // a non-secret alias of the account, not its phone number
        account: 'assistant',
        // only these senders start runs; everybody else is ignored
        policy: { senders: WHATSAPP_SENDERS.split(',') },
        resolveInvoker: (identity) => ({
            id: identity.sender,
            kind: 'whatsapp',
            permissions: [],
        }),
        // a link to the approval in the chamvi UI: ids only, answered there
        approvalUrl: ({ runId, approvalId }) => `${APP_URL}/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
        ...options,
    });

    const reply = defineTool({
        description: 'Reply in the chat the message came from.',
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }, { context }) => {
            // the source chat: no address needed
            await context.channels.findOneOrFail('chat').emit({ body: text });

            return 'sent';
        },
    });

    const assistant = defineAgent({
        name: 'assistant',
        model,
        instructions: 'You are the owner\'s assistant on WhatsApp. Answer with the reply tool.',
        // one memory per direct chat and one per group
        conversation: true,
        // direct messages and mentions in an allowed group
        channels: [whatsapp.channel.on()],
        tools: { reply },
    });

    return new Engine({
        // memory store: conversations included; use @chamvi/store-db in production
        store: createMemoryStore({ clock: options.clock }),
        agents: [assistant],
        channels: [whatsapp.channel],
        clock: options.clock,
        conversations: { authorize: ({ agent }) => agent === 'assistant' },
    });
}
```

Nothing connects when the setup is built: the channel's `start` (the engine's) initializes the Chat, acquires the auth lease, then builds the socket. While the account is not paired, `onPairing` receives a QR reference to render for the phone (it rotates); it never reaches a log or `onError`. `setup.status()` reports `stopped`, `connecting`, `connected`, `disconnected` or `logged-out`, from Baileys' connection events only.

`auth` is an `IWhatsAppAuthProvider` you supply: chamvi ships no production session store (see [WhatsApp operations](#whatsapp-operations)). `state` is a Chat SDK `StateAdapter`; chamvi's intake does not depend on its deduplication.

Who may start runs is `policy`:

| Policy | Allows |
|---|---|
| `{ senders: [...] }` | Direct messages of the listed phone number jids (`<digits>@s.whatsapp.net`, no device suffix) |
| `groups: [...]` | Messages in the listed group jids (`<id>@g.us`) from an allowed sender, by default only when they mention the bot (`requireGroupMention: false` drops that) |
| `{ open: true }` | Any resolved sender; `resolveInvoker` decides (undefined denies) |

A message starts runs only when its identity is authenticated, the policy allows it and `resolveInvoker` names an invoker. The bot's own messages, unknown senders and a sender whose LID cannot be resolved to a phone number through Baileys' authenticated mapping are denied silently: no run, no reply, no download.

## Other Chat SDK adapters

Any Chat SDK `Adapter` works through the generic channel. Wrap it with `createChatIngressAdapter()` before registering it with the `Chat`, so chamvi's intake, not the SDK's handlers and pre-handler deduplication, accepts its messages; the channel owns that `Chat` alone:

```ts
import { Chat } from 'chat';
import { chatChannel, createChatIngressAdapter } from '@chamvi/chat';

const ingress = createChatIngressAdapter(platformAdapter);
const chat = new Chat({ userName: 'chamvi', adapters: { [ingress.name]: ingress }, state, concurrency: 'concurrent' });
const channel = chatChannel({
    chat,
    adapters: [ingress],
    // required for every adapter: who may start runs
    allowMessage: ({ message }) => allowed.has(message.author.userId),
    // the adapters whose platform posts webhooks to POST /channels/chat/<adapter>
    webhooks: [ingress.name],
    approvalUrl: ({ runId, approvalId }) => `${APP_URL}/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
});
```

`connect`/`disconnect` hook a socket-style adapter into the channel's start and stop; `resolveInvoker` names the runs' invoker. Generic webhook adapters are covered by tests with fake adapters only: chamvi has verified no platform but WhatsApp Web.

A webhook adapter's platform posts to `POST /channels/<channel>/<adapter>` (the http app's channel mount; only the adapters listed in `webhooks`, anything else 404). The body is read up to `CHAT_BODY_LIMIT_BYTES` (1 MiB, 413 above it) and handed to the adapter's own `handleWebhook`, which verifies the request. The answer waits until every message the adapter handed over is stored as runs (at most `CHAT_WEBHOOK_TIMEOUT_MS`, 30 s), and is a 503 when one could not be, so the platform redelivers; GET challenge flows are not served. Only messages the adapter hands over within the request's async context are tracked: an adapter that passes them to a consumer started outside it (a queue, a pre-request listener) is not waited for, and its own 2xx stands. The mount sits under the http app's general rate limit unless `channelRateLimits` names the channel.

## Subscriptions and replies

`channel.on({ adapter?, events?, id?, filter?, concurrencyMaxRuns? })` subscribes an agent; `events` are `direct` (a direct chat), `mention` (the bot mentioned in a group) and `message` (any other group message), default `['direct', 'mention']`. `chat.on()` does the same for the channel named `chat`. A run's payload is a small `ChatPayload` (`adapter`, `event`, `threadId`, `channelId`, `message: { id, text, author, sentAt? }`), never the platform's raw object; its address is the chat, so a tool's `emit()` without an address replies there. `channel.to({ adapter, threadId })` builds the address of another chat.

A message is accepted once per agent (the idempotency key hashes channel, adapter, thread and message id), so a redelivery starts no second run; a transient store failure is retried twice (1 s, 2 s), then reported as `chat_intake_failed`.

Approvals (`ctx.channels.findOneOrFail('chat').approve()`) send a text with the title, the body (cut to fit), the options and the `approvalUrl` link; the owner answers in the chamvi UI. The link carries ids only; there are no native buttons, and a reply in the chat does not answer an approval.

## Memory

An agent with `conversation: true` gets one memory per chat through core's [conversation memory](https://chamvi.dev/guide/conversations): the channel binds each message through the engine's trusted conversation intake, never through a payload field. It needs a store with `conversations` (`createMemoryStore()` or `@chamvi/store-db`) and the engine's `conversations: { authorize }` (`createApp({ conversations })`). The identity is the channel, the `account` alias, the chat and an audience: `direct:<sender>` for a direct chat, `group:<chat>` for a group (WhatsApp: the group jid), so a group shares one memory among its members. Accepted message text and replies emitted to the source chat are remembered; `history: 0` is the only setting (no platform history is fetched).

## Trust

Every run a chat channel starts is tainted (`untrusted: true` by default; `false` only for a fully trusted private deployment), so tools classified `guardWhenTainted` ask for approval (or are denied) in these runs. A reply to the source chat is exempt from the outbound gate; a send to another chat goes through it. A configured `defaultAddress` is exempt too: it is an ungated sink for tainted runs, so none is set by default.

## Limits

- Text only: a message with attachments or without text is refused (reported, no run). No media download.
- No history (`history: 0`), no message splitting: a message above `CHAT_TEXT_MAX_CHARS` (4096 UTF-16 code units) is refused; an approval cuts only its prose.
- `ChannelMessage.slot` is ignored: every message is a new chat message.
- Delivery is at least once: a send is bounded by `timeoutMs` (default `CHAT_TIMEOUT_MS`, 30 s); a send that times out may still be delivered and a retry may send it again. A send while the channel is stopped or draining fails.
- WhatsApp: no lossless or offline ingestion. A message that arrives while the connector is down, or that the process loses before it is stored, is not fetched later.

## WhatsApp operations

WhatsApp Web through Baileys is an **unofficial protocol**: WhatsApp may change it or restrict the account. Use an account you can afford to lose and read the [WhatsApp guide](https://chamvi.dev/deployment/whatsapp) before a live cutover. In short:

- **Auth provider required.** The lease (`acquire(signal)` -> `{ auth, saveCreds, flush, release }`) must persist creds and signal keys atomically and serialized, and take the location exclusively (a second holder refused). chamvi guards every auth call with the lease's generation, flushes before releasing and keeps a lease fenced (not released) when writes outlive `WHATSAPP_SHUTDOWN_TIMEOUT_MS` (30 s).
- **One connector.** Run one deployment per account, `Recreate`/stop-then-start, never two replicas.
- **Pairing** is by QR (`onPairing`) only; no phone-number code.
- **Reconnect**: an unexpected close reconnects with backoff (`WHATSAPP_RECONNECT`: 2 s growing to 30 s, 12 attempts). A logout (401) or a replacing session (440) does not: pair again, then restart; the lease stays held until the channel stops.
- **Stop** ends the socket, refuses later auth writes and flushes. Baileys may retry a decrypt whose key commit the stop refused (for about 30 s, to nothing); chamvi does not guarantee that such a message is processed after the restart.
- **Logging**: Baileys' own logger is silent (it would carry pairing material), which also hides its decrypt and LID warnings.

## With @chamvi/app

```ts
import { createApp } from '@chamvi/app';
import { chatModule } from '@chamvi/chat/module';

const whatsapp = createWhatsAppChat({ ... });

export default createApp({
    agents: [assistant],
    modules: [chatModule({ channel: whatsapp.channel })],
    conversations: { authorize: ({ agent }) => agent === 'assistant' },
});
```

`chatModule()` contributes the channel to `AppToken.CHANNELS` (module name `chamvi:channel:<name>`); the engine starts and stops it, and the http module mounts its `in` when it serves webhooks. It adds no env variable and constructs nothing, so `chamvi start --check` neither acquires the auth lease nor connects.

## API

| Export | Entry |
|---|---|
| `chatChannel(options)`, `createChatIngressAdapter(adapter)`, `chat`, `chatAddress()`, `createChatSubscription()` | `@chamvi/chat` |
| `CHAT_CHANNEL_NAME` `'chat'`, `CHAT_TEXT_MAX_CHARS` 4096, `CHAT_TIMEOUT_MS` 30 000, `CHAT_BODY_LIMIT_BYTES` 1 MiB, `CHAT_WEBHOOK_TIMEOUT_MS` 30 000, `CHAT_STOP_TIMEOUT_MS` 30 000, `CHAT_EVENTS`, `DEFAULT_CHAT_EVENTS`, `CHAT_ADDRESS_PREFIX` | `@chamvi/chat` |
| Error codes `chat_request`, `chat_intake_failed`, `chat_stop_timeout` (`CHAT_*_ERROR_CODE`) | `@chamvi/chat` |
| `createWhatsAppChat(options)`, `WHATSAPP_ADAPTER_NAME` `'whatsapp'`, `WHATSAPP_RECONNECT`, `WHATSAPP_SHUTDOWN_TIMEOUT_MS`, `whatsapp_auth`/`whatsapp_connection`/`whatsapp_logged_out` (`WHATSAPP_*_ERROR_CODE`) | `@chamvi/chat/baileys` |
| `chatModule(options)`, `ChatModule` | `@chamvi/chat/module` |

The full option reference is the [chat reference](https://chamvi.dev/reference/chat).

## License

Made with 💚

Published under [Apache License 2.0](./LICENSE).
