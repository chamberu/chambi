# OpenClaw

OpenClaw is a personal assistant gateway that connects chat channels to agents. chamvi's integration contract is **"MCP in, hooks out"**.

## MCP in

Each chamvi app serves an MCP endpoint at `/mcp` (Streamable HTTP, from [`@chamvi/http`](/guide/http#mcp)). OpenClaw lists it among its MCP servers and gets:

- one `run_<agent>` tool per agent with an `http.on()` subscription, which starts a run (channel `mcp`) and returns the run id (or, with `waitSeconds`, waits up to a minute and returns the output or the pending approval),
- `get_run` and `list_runs` for status,
- `approve_run`, which needs `agent:<name>:approve`: OpenClaw's principal should not hold it (see below), so for OpenClaw it always fails.

The endpoint uses the same bearer-token authentication as the REST API; give OpenClaw a principal with `agent:<name>:run`, which also lets it read the runs it starts. Never give it `agent:<name>:approve`: the owner answers approvals in the chamvi UI, signed in as a principal of their own. This is how the owner says "what's relevant in my mail today?" in a chat and gets a run started.

## Hooks out

Messages and approval requests flow back through the OpenClaw [channel](/guide/channels), [`@chamvi/channel-openclaw`](/reference/channel-openclaw): `POST <openclaw><hooks.path>/agent` with OpenClaw's hooks token as bearer token, the message key as `Idempotency-Key` header and the delivery target (channel and recipient). The channel is out only:

<<< @/snippets/channel-openclaw.ts#channel

A tool sends through it with `ctx.channels.findOne('openclaw')`: `emit()` for a message, `approve()` to pause the call until the owner answers. The address is the recipient; without one the call sends to `deliver.to`, the channel's `defaultAddress`:

<<< @/snippets/channel-openclaw.ts#tool

In the OpenClaw configuration:

| Key | Value |
|---|---|
| `hooks.enabled` | `true` (hooks are off by default) |
| `hooks.token` | A dedicated token, passed as `hooksToken`; not the gateway token |
| `hooks.path` | `/hooks` (the default `hooksPath`), or the same value on both sides |
| `hooks.allowedAgentIds` | Lists the `agentId` you pass, if any |
| `mcp.servers` | The app's `/mcp` endpoint with a token of a principal holding `agent:<name>:run`, never `agent:<name>:approve` |

`deliver.channel` and `deliver.to` must name a concrete destination of your OpenClaw setup (OpenClaw refuses `channel: 'last'` and a partial destination for hooks); the examples use placeholders. `deliver.to` is the channel's `defaultAddress`, which the outbound gate exempts: a run tainted by untrusted content can still send to it without approval, so pick a recipient that may receive what any such run produces (see [untrusted content and outbound tools](/guide/tools#untrusted-content-and-outbound-tools)).

For approvals the message includes how to answer: the `approvalUrl` link when configured, e.g. `https://<app>/ui/approvals?run=<runId>&approval=<approvalId>`, which opens the run's approval in the UI, where the signed-in owner answers it through `POST /runs/:id/approve` (the owner's principal needs `agent:<agent>:approve` to answer and `run:read` or `agent:<agent>:run` for the UI to show the run's approval); else a line saying to answer in the chamvi UI or through `POST /runs/:id/approve`.

::: warning The OpenClaw agent cannot approve
The approval's title and body are what the tool wrote and may repeat untrusted text (an issue body, a mail). OpenClaw wraps hook content as external, but that does not take tools away. The message carries no token, so a relay agent whose principal holds only `agent:<name>:run` cannot approve, whatever an injected instruction says: only the owner, signed in to the UI, approves.
:::

### Caveats

- OpenClaw runs an agent turn on the message (it does not post raw text) and treats it as external content; the message asks that agent to keep every link and id verbatim.
- OpenClaw's idempotency replay is in memory and lasts 5 minutes after completion; a restart clears it. chamvi's records (the emit effect, the approval's `waiting.notifiedAt` and its per-approval lock) are the primary dedupe, the key covers a response lost within those minutes.
- A misconfigured hook (400, 401, 404) fails on every send: an `emit()` is a tool error, an approval message reaches `onError` on every poll.
- Keys over 256 characters (which OpenClaw ignores) or with characters outside visible ASCII are sent as `sha256:<hex>`.

## In the cluster

OpenClaw runs elsewhere in the cluster. It reaches each app at `http://<service>/mcp`, and the app reaches OpenClaw's hooks endpoint. Neither needs to be public.
