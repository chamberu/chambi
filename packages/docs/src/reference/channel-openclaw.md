# @chamvi/channel-openclaw

The OpenClaw channel. The public API of `packages/channel-openclaw/src/index.ts`.

```bash
npm install @chamvi/channel-openclaw @chamvi/core --save
```

`@chamvi/core` is a peer dependency; the channel uses the global `fetch`. See [OpenClaw](/deployment/openclaw) for the setup.

## openclawChannel

```ts
function openclawChannel(options: OpenclawChannelOptions): IChannel; // out only, name default 'openclaw'

const OPENCLAW_CHANNEL_NAME: 'openclaw';
const DEFAULT_HOOKS_PATH: '/hooks';
const OPENCLAW_TIMEOUT_MS: 30_000;
const OPENCLAW_REQUEST_ERROR_CODE: 'openclaw_request';
const MESSAGE_BODY_MAX_LENGTH: 8_000;
```

<<< ../../../channel-openclaw/src/channel/types.ts#public{ts}

Throws `InvalidAgentDefinitionError` for an invalid `name`, an empty `hooksToken`, `agentId`, `deliver.to` or `deliver.accountId`, a `deliver.channel` that is empty or `last`, a `baseUrl` that is no absolute `http:`/`https:` URL or carries credentials, a query or a hash, a `hooksToken` that `fetch` could not send as a header (a control character, a character above U+00FF, surrounding whitespace), a `hooksPath` that does not start with `/` or is `/` (trailing slashes are dropped, so `/hooks/` posts to `/hooks/agent`), an `approvalUrl` that is no function and a `timeoutMs` that is no positive integer.

<<< @/snippets/channel-openclaw.ts#channel

Tools send through it with `ctx.channels.findOne('openclaw')` (`emit()`, `approve()`); the address is the recipient, and an empty one sends to `deliver.to`:

<<< @/snippets/channel-openclaw.ts#tool

### The request

`out(message, address)` sends one `POST <baseUrl><hooksPath>/agent`:

| Part | Value |
|---|---|
| `authorization` | `Bearer <hooksToken>` |
| `idempotency-key` | `message.key` (an emit's content-addressed key, `<runId>:<approvalId>` for an approval), or `sha256:<hex>` of it when it is longer than 256 characters or holds anything but visible ASCII |
| body | `OpenclawHookBody`: `{ message, name: 'chamvi', agentId?, deliver: true, channel, to, accountId? }`; `to` is the address, or `deliver.to` for an empty one |

The message is deterministic for one key (no clock value, no random id), so a resend after a lost response is byte-identical and OpenClaw replays it:

```
chamvi message. Relay it to the user; keep every link and id exactly as written.

<title>

<body, cut to MESSAGE_BODY_MAX_LENGTH characters>

Agent: <agent>
Run: <runId>

Expires: <expiresAt ISO>
Approve or deny: <approvalUrl({ runId, approvalId, agent })>
```

The title and body appear when the message has them. An approval with options adds a block after the body, `Options (choose one):` (or `Options (choose one or more):`) and a `- <id>: <label>` line per option (never the detail), and its link line reads `Choose and approve or deny: <link>`, without `approvalUrl` `Choose in the chamvi UI or through POST /runs/:id/approve with selected.` The last block is sent for approvals only; for an approval without options and without `approvalUrl` its last line reads `Answer it in the chamvi UI or through POST /runs/:id/approve.` instead. `approvalUrl` gets the run id, the approval id and the agent. A cut body ends with `… (cut, <n> more characters)` and never splits a surrogate pair.

### Failures

Any 2xx resolves. Every other status throws a `ChamviError` with `code` `openclaw_request` and the message `OpenClaw <status>: <response text>` (plus `(retry after <value>)` for a `Retry-After` header); a network failure throws `OpenClaw request failed: <message> (<cause message>)` (undici keeps the detail, such as `ECONNREFUSED` or `ENOTFOUND`, in `cause`), a send that takes longer than `timeoutMs` `OpenClaw did not answer within <ms>ms.` (the timer runs on the `clock` and aborts the `fetch`); an abort of the caller's signal (the run cancelled, the engine draining) rejects with its reason. The response text and the network failure message are cut to 500 characters after the hooks token was replaced by `[redacted]`, so an endpoint that echoes the request never puts it into `onError`. A failed `emit()` is a tool error and records nothing; a failed approval message is re-sent by `tick()`.

## Module

```ts
// @chamvi/channel-openclaw/module, needs @chamvi/app
function openclawModule(options?: OpenclawModuleOptions): IModule; // name 'chamvi:channel:<name>', default name 'openclaw'
```

Reads `OPENCLAW_BASE_URL`, `OPENCLAW_HOOKS_TOKEN`, `OPENCLAW_CHANNEL`, `OPENCLAW_TO` (required), `OPENCLAW_HOOKS_PATH`, `OPENCLAW_AGENT_ID` and `OPENCLAW_ACCOUNT_ID` from `options.env ?? process.env` when it is called (options win), defaults `approvalUrl` to the dashboard link from `CHAMVI_PUBLIC_URL` and contributes the channel to the app's channels (`AppToken.CHANNELS`), so the engine registers it and tools reach it with `ctx.channels.findOne(name)`. `@chamvi/app` is an optional peer: the main entry never imports it.

<<< ../../../channel-openclaw/src/module/types.ts{ts}
