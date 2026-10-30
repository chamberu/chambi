<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/channel-openclaw" width="128" height="128" />
</p>

<h1 align="center">@chamvi/channel-openclaw</h1>

<p align="center">
    <b>OpenClaw channel for chamvi agents.</b><br>
    Messages and approval requests reach the owner in an OpenClaw chat,<br>
    once per message, even when the engine retries the send.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/channel-openclaw"><img src="https://img.shields.io/npm/v/@chamvi/channel-openclaw" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/channel-openclaw/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/channel-openclaw" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [OpenClaw setup](#openclaw-setup)
- [Usage](#usage)
- [Answering approvals](#answering-approvals)
- [Caveats](#caveats)
- [With @chamvi/app](#with-chamviapp)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/channel-openclaw @chamvi/core --save
```

ESM only, Node.js `>=22`. `@chamvi/core` is a peer dependency; the channel uses the global `fetch` and has no runtime dependencies.

chamvi and OpenClaw talk **"MCP in, hooks out"**: OpenClaw starts and reads runs through the app's MCP endpoint (`@chamvi/http`), and chamvi pushes messages to OpenClaw's hooks endpoint through this channel. The channel is out only: it has no `in` and no subscriptions.

## OpenClaw setup

In the OpenClaw gateway configuration:

1. Enable hooks (`hooks.enabled: true`; they are off by default) and set a **dedicated `hooks.token`**. It is not the gateway token; the channel sends it as `Authorization: Bearer <token>`.
2. Keep `hooks.path` at `/hooks` or pass the same value as `hooksPath`.
3. When you pass `agentId`, list it in `hooks.allowedAgentIds`.
4. Add the chamvi app's MCP endpoint (`http://<service>/mcp`) to OpenClaw's `mcp.servers`, with a bearer token of a principal holding `agent:<name>:run` to start runs. Never give it `agent:<name>:approve`: the owner answers through the `approvalUrl` link, signed in to the chamvi UI as a principal of their own (see [Answering approvals](#answering-approvals)).

## Usage

`openclawChannel()` is an `IChannel`; register it on the engine (`channels`) and send through it from a tool with `ctx.channels.findOne('openclaw')`: `emit()` for a message, `approve()` to pause the tool call until the owner answers:

```typescript
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { openclawChannel } from '@chamvi/channel-openclaw';
import type { OpenclawChannelOptions } from '@chamvi/channel-openclaw';

export function createApprovalEngine(
    model: LanguageModel,
    options: Pick<OpenclawChannelOptions, 'fetch' | 'clock'> = {},
): Engine {
    const {
        OPENCLAW_URL,
        OPENCLAW_HOOKS_TOKEN,
        OPENCLAW_CHANNEL,
        OPENCLAW_TO,
        APP_URL,
    } = process.env;
    if (!OPENCLAW_URL || !OPENCLAW_HOOKS_TOKEN || !OPENCLAW_CHANNEL || !OPENCLAW_TO || !APP_URL) {
        throw new Error('Set OPENCLAW_URL, OPENCLAW_HOOKS_TOKEN, OPENCLAW_CHANNEL, OPENCLAW_TO and APP_URL.');
    }

    const openclaw = openclawChannel({
        baseUrl: OPENCLAW_URL,
        // OpenClaw's hooks.token, not the gateway token
        hooksToken: OPENCLAW_HOOKS_TOKEN,
        deliver: { channel: OPENCLAW_CHANNEL, to: OPENCLAW_TO },
        // a link to the approval in the chamvi UI, without the token
        approvalUrl: ({ runId, approvalId }) => `${APP_URL}/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
        ...options,
    });

    const deploy = defineTool({
        description: 'Deploy the current release to an environment.',
        inputSchema: z.object({ env: z.enum(['staging', 'prod']) }),
        execute: async ({ env }, { context }) => {
            // every deploy waits for the owner, who is asked in their chat
            const { approved } = await context.channels.findOneOrFail('openclaw').approve({
                title: `Deploy to ${env}?`,
                body: 'The current release goes out now.',
                address: OPENCLAW_TO,
            });
            return approved ? `deployed to ${env}` : 'the owner said no';
        },
    });

    const deployer = defineAgent({
        name: 'deployer',
        model,
        instructions: 'Deploy the release the user asks for.',
        tools: { deploy },
    });

    return new Engine({
        store: createMemoryStore({ clock: options.clock }),
        agents: [deployer],
        channels: [openclaw],
        clock: options.clock,
    });
}
```

Every message becomes one `POST <baseUrl><hooksPath>/agent` with the body `{ message, name: 'chamvi', agentId?, deliver: true, channel, to, accountId? }`, the hooks token as bearer token and the message key as `Idempotency-Key` (`<runId>:<approvalId>` for an approval, the content-addressed emit key for a message). `channel` is `deliver.channel`; `to` is the address the tool passed, or `deliver.to` (the channel's `defaultAddress`) when the tool passed none. The text holds the message's title, its body (cut to 8 000 characters), the agent and the run id; for an approval also the expiry and the `approvalUrl` link when configured (without it, a line saying to answer in the chamvi UI or through `POST /runs/:id/approve`).

Any 2xx response counts as sent (OpenClaw answers `200 { ok: true, runId }` once it admitted the hook). Every other answer throws a `ChamviError` with code `openclaw_request` (`OpenClaw <status>: <response text>`, with `retry after <s>` for a `Retry-After`), as does a network failure (`OpenClaw request failed: <message> (<cause>)`, the cause naming e.g. `ECONNREFUSED` or `ENOTFOUND`) and a gateway that does not answer within `timeoutMs` (30 s); an aborted send (the run cancelled, the engine draining) rejects with the abort reason. A failed `emit()` is a tool error and records nothing, so the next identical emit sends again. A failed approval message goes to the engine's `onError`, and the engine sends again on the next poll, with the same key and a byte-identical body, until one send succeeds.

## Answering approvals

The message carries no token and no MCP call, only the approval link:

- **A link** (`approvalUrl({ runId, approvalId, agent })`), when configured, to the run's approval in the chamvi UI, e.g. `https://<app>/ui/approvals?run=<runId>&approval=<approvalId>`. The link holds ids only; the owner opens it, signs in and answers through the token-less `POST /runs/:id/approve`. The signed-in principal needs `agent:<agent>:approve` to answer and `run:read` or `agent:<agent>:run` for the UI to load the run and show its approval.
- Without `approvalUrl`, the message says to answer in the chamvi UI or through `POST /runs/:id/approve`.

**The OpenClaw agent cannot approve.** The approval's title and body are what the tool wrote, which may repeat untrusted text (an issue body, a mail), so an injected instruction reaches the OpenClaw agent. The message carries no token, and a relay agent whose MCP principal holds only `agent:<name>:run` has neither a token nor the right to answer: whatever the body says, only the owner, signed in to the UI, approves.

## Caveats

- OpenClaw runs an agent turn on the message (it does not post raw text) and treats it as external content, so the wording in the chat is the OpenClaw agent's.
- OpenClaw's idempotency replay lives in memory and lasts 5 minutes after the run completed; a restart clears it. chamvi's records (the emit effect, the approval's `waiting.notifiedAt` and its per-approval lock) are the primary dedupe; the key only covers a response lost within those minutes.
- A misconfigured hook (400, 401, 404) fails on every send, and an approval message reaches `onError` on every poll, until it is fixed or the approval times out.
- OpenClaw ignores an `Idempotency-Key` over 256 characters; such keys (and keys with whitespace or non-ASCII characters) are sent as `sha256:<hex>`.
- Errors never carry the hooks token: it is replaced by `[redacted]` in the response text and the network failure message, each cut to 500 characters. A `hooksToken` that `fetch` could not send as a header (control characters, characters above U+00FF, surrounding whitespace) is refused when `openclawChannel()` is called.

## With @chamvi/app

`openclawModule()` from `@chamvi/channel-openclaw/module` reads `OPENCLAW_BASE_URL`, `OPENCLAW_HOOKS_TOKEN`, `OPENCLAW_CHANNEL`, `OPENCLAW_TO`, `OPENCLAW_HOOKS_PATH`, `OPENCLAW_AGENT_ID` and `OPENCLAW_ACCOUNT_ID` when it is called, links approvals to the dashboard from `CHAMVI_PUBLIC_URL` and contributes the channel (module `chamvi:channel:<name>`); tools reach it with `ctx.channels.findOne(name)`. `@chamvi/app` is an optional peer; the main entry never imports it.

```ts
import { createApp } from '@chamvi/app';
import { openclawModule } from '@chamvi/channel-openclaw/module';

export default createApp({ agents, modules: [openclawModule(), openclawModule({ name: 'ops' })] });
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | required | The gateway, e.g. `http://openclaw:18789`; an absolute `http:`/`https:` URL without credentials, query or hash. A base path is kept |
| `hooksToken` | `string` | required | OpenClaw's `hooks.token`; a valid header value (no control characters, nothing above U+00FF, no surrounding whitespace) |
| `deliver` | `{ channel, to, accountId? }` | required | Where OpenClaw delivers the answer; `channel` and `to` must be concrete (`last` is refused); also the channel's `defaultAddress`, so a tool may leave the address out; an address the tool passes replaces `to` |
| `name` | `string` | `'openclaw'` | The channel name `ctx.channels.findOne(name)` takes; a second instance needs its own |
| `hooksPath` | `string` | `'/hooks'` | OpenClaw's `hooks.path`; starts with `/`, not `/` itself; trailing slashes are dropped |
| `agentId` | `string` | none | The OpenClaw agent that phrases the message |
| `approvalUrl` | `({ runId, approvalId, agent }) => string` | none | A link to the approval in the chamvi UI, added to approval messages; it carries no token (see [Answering approvals](#answering-approvals)) |
| `timeoutMs` | `number` | `30_000` | Bound of one send, on the `clock` |
| `clock` | `IClock` | `systemClock` | Time source of the timeout |
| `fetch` | `typeof fetch` | `globalThis.fetch` | The HTTP client (tests pass a fake) |

Every option is checked when `openclawChannel()` is called; a bad one throws `InvalidAgentDefinitionError`.

## API

| Export | Kind | Purpose |
|---|---|---|
| `openclawChannel` | function | `openclawChannel(options)`: an out-only `IChannel` posting to OpenClaw's hooks endpoint |
| `OPENCLAW_CHANNEL_NAME` | constant | `'openclaw'`, the default `name` |
| `DEFAULT_HOOKS_PATH` | constant | `'/hooks'` |
| `OPENCLAW_TIMEOUT_MS` | constant | `30_000`, the default `timeoutMs` |
| `OPENCLAW_REQUEST_ERROR_CODE` | constant | `'openclaw_request'`, the `code` of every send failure |
| `MESSAGE_BODY_MAX_LENGTH` | constant | `8_000`, the cut of the message body |

Types: `OpenclawChannelOptions`, `OpenclawApprovalRef`, `OpenclawDelivery`, `OpenclawHookBody`.

`@chamvi/channel-openclaw/module`: `openclawModule`, `OpenclawModule`, type `OpenclawModuleOptions`.

## License

Made with 💚

Published under [Apache License 2.0](./LICENSE).
