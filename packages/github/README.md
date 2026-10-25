<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/github" width="128" height="128" />
</p>

<h1 align="center">@chamvi/github</h1>

<p align="center">
    <b>The GitHub channel and tools for chamvi agents.</b><br>
    A verified delivery becomes one deduplicated run per matching agent, answers land as issue comments,<br>
    and GitHub writes never post twice after a retry, a recovery or a crash.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/github"><img src="https://img.shields.io/npm/v/@chamvi/github" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/github/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/github" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [GitHub App setup](#github-app-setup)
- [Usage](#usage)
- [Inbound: deliveries](#inbound-deliveries)
- [Subscriptions](#subscriptions)
- [Outbound: comments](#outbound-comments)
- [Approvals](#approvals)
- [Tools](#tools)
- [Security](#security)
- [Context](#context)
- [With @chamvi/app](#with-chamviapp)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/github @chamvi/http @chamvi/core ai --save
```

ESM only, Node.js `>=22`. `@chamvi/core`, [`@chamvi/http`](../http) (it serves the channel's deliveries) and `ai` are peer dependencies. GitHub is reached through [`@octokit/core`](https://www.npmjs.com/package/@octokit/core) with the pagination plugin; the App JWT, the installation tokens and the webhook signatures use `node:crypto`.

## GitHub App setup

One GitHub App per agent repository (or organisation):

1. Create a GitHub App. Set the **webhook URL** to `https://<host><basePath>/channels/github` (the channel's name), the **content type to `application/json`** (a hook created by hand defaults to `application/x-www-form-urlencoded`, which the channel answers with `415`) and a **webhook secret**.
2. Grant the permissions your tools need: *Issues* read and write for labels, comments and closing; *Pull requests* read; *Contents* read for `github_get_file` and `github_get_latest_release` (read and write for workspaces that push, *Workflows* write to push changes under `.github/workflows`). Subscribe to the events your subscriptions name (e.g. *Issues*).
3. Generate a private key and install the App on the repositories the agents may act on.
4. Pass the App id, the private key (PKCS#1 or PKCS#8 PEM; a one-line env var with literal `\n` works) and the webhook secret to `createGithubApp()`. Set `slug` in production, so the bot login needs no `GET /app`.

## Usage

`createGithubApp()` holds the App credentials. `githubChannel({ app })` is the channel: register it on the engine and list it in `createHttpApp({ channels })`, which serves its deliveries at `POST /channels/github`. Agents subscribe with `github.on(events)`; `gh.readTools()` / `gh.writeTools()` are plain AI SDK `ToolSet`s:

```typescript
import type { LanguageModel } from 'ai';
import {
    Engine,
    MemoryStore,
    ToolDeniedError,
    defineAgent,
} from '@chamvi/core';
import { createGithubApp, github, githubChannel } from '@chamvi/github';
import type { GithubAppOptions } from '@chamvi/github';
import { createHttpApp, createShutdown, staticTokens } from '@chamvi/http';

export async function createTriageServer(
    model: LanguageModel,
    options: Pick<GithubAppOptions, 'fetch' | 'clock'> = {},
) {
    const {
        GITHUB_APP_ID,
        GITHUB_PRIVATE_KEY,
        GITHUB_WEBHOOK_SECRET,
        CHAMVI_TOKEN,
    } = process.env;
    if (!GITHUB_APP_ID || !GITHUB_PRIVATE_KEY || !GITHUB_WEBHOOK_SECRET || !CHAMVI_TOKEN) {
        throw new Error('Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET and CHAMVI_TOKEN.');
    }

    const gh = createGithubApp({
        appId: GITHUB_APP_ID,
        privateKey: GITHUB_PRIVATE_KEY,
        webhookSecret: GITHUB_WEBHOOK_SECRET,
        ...options,
    });
    // deliveries in, issue comments out
    const channel = githubChannel({ app: gh, clock: options.clock });

    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Label new issues and thank the author in one comment.',
        // one run per issues.opened delivery, deduplicated by the delivery id
        channels: [github.on('issues.opened')],
        tools: () => ({ ...gh.readTools(), ...gh.writeTools() }),
        hooks: {
            // closing waits for the owner, asked in a comment on the issue
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'github_close_issue') return undefined;
                const { approved } = await ctx.channels.findOneOrFail('github').approve({
                    title: 'Close this issue?',
                    body: JSON.stringify(input),
                });
                if (!approved) throw new ToolDeniedError('The owner keeps the issue open.');
                return undefined;
            },
        },
    });

    const engine = new Engine({
        store: new MemoryStore(),
        agents: [triage],
        channels: [channel],
    });

    const shutdown = createShutdown({ engine });
    const app = createHttpApp({
        engine,
        auth: staticTokens({
            tokens: [{
                value: CHAMVI_TOKEN,
                id: 'ci',
                permissions: ['*'],
            }],
        }),
        // POST /channels/github: point the App's webhook URL here
        channels: [channel],
        shutdown,
    });

    await engine.start();
    return {
        app,
        engine,
        shutdown,
    };
}
```

## Inbound: deliveries

`POST /channels/github` (the channel's `in`, under the http app's `basePath`; a second channel `githubChannel({ name: 'github-ent' })` is served at `/channels/github-ent`) checks, in this order:

| Check | Answer |
|---|---|
| A path below the channel's (`/channels/github/...`) | `404` |
| `X-Hub-Signature-256` missing | `401` |
| `X-GitHub-Event` not `^[a-z0-9_]+$`, `X-GitHub-Delivery` not 1 to 255 characters | `400` |
| Body above the channel's `bodyLimit` (1 MiB by default) | `413` |
| Non-JSON content type (e.g. `application/x-www-form-urlencoded`) | `415` |
| `sha256=` HMAC of the raw body bytes under none of the webhook secrets | `401` |
| Body not a JSON object | `400` |

A verified delivery is dispatched to every agent with a matching `github.on()` subscription of this channel, **at most one run per agent** (its first matching subscription), with `channel: 'github'`, the `GithubEvent` as payload and, for an event with an issue or pull request, the address `<owner>/<repo>#<number>` (`run.address`, where `ctx.channels.findOne()` answers). The answer is `202 { delivery, runs: [{ agent, runId, deduplicated }] }`, also for `ping`, for events no subscription matches and for events the App sent itself (`runs: []`).

- **Dedupe**: the idempotency key is the delivery id (or the subscription's `idempotencyKey(event)`), so a redelivery returns the existing runs with `deduplicated: true`. The signature covers the body only, neither the `X-GitHub-Delivery` nor the `X-GitHub-Event` header (`e.delivery`, `e.name`): whoever holds one signed delivery (a proxy log, a support dump) can replay it under new delivery ids, or under another event name an agent listens on, and start a new run each time. On an exposed endpoint, derive the key from body fields only, e.g. `` idempotencyKey: (e) => `${e.action}:${e.payload.repository?.full_name}#${e.payload.issue?.number}@${e.payload.issue?.updated_at}` ``, and let a `filter` check that the body carries what the event name implies (`issue` without `comment` for `issues`, `comment` for `issue_comment`, `pull_request` for `pull_request`).
- **Failures**: agents are matched and dispatched in order and a failing one (a throwing `filter` or key function, a key `dispatch` refuses, a failed dispatch) does not stop the others; each failure goes to the channel's `onError`, and the answer is then `500`. **GitHub does not redeliver failed deliveries automatically**: redeliver a `4xx`/`5xx` delivery by hand (the App's *Advanced* tab) or through the redelivery API. A redelivery keeps the delivery id, so the agents that already got their run are deduplicated.
- **Self guard**: a delivery whose `sender` is the App's own bot (`<slug>[bot]`, `type: 'Bot'`) starts no run, so an agent is not woken by its own comment. Other bots (`dependabot[bot]`, a second chamvi App on the same repository) are ordinary senders; use a subscription `filter` to break loops between two Apps.
- **Body size**: issue and comment deliveries are far below 1 MiB; raise `bodyLimit` on `githubChannel()` for large `push` or `pull_request` deliveries (GitHub sends up to 25 MB), which are otherwise answered `413`.
- Channel routes are rate limited like every route of the http app (300 per minute per client address by default) and never authenticated by its authenticators: the signature is the credential.

## Subscriptions

```ts
github.on(['issues.opened', 'issue_comment.created'], {   // 'issues' matches every action
    filter: (event) => event.payload.repository?.full_name === 'octo/demo',
});
```

| Option | Default | Description |
|---|---|---|
| `events` | required | `'<event>'` or `'<event>.<action>'`, one or an array |
| `id` | `github:<events joined by ','>` | Subscription id; two subscriptions with the same events need distinct ids |
| `filter` | none | `(event) => boolean`, after the event match; also the way to break loops between two Apps, which see each other as ordinary bots |
| `idempotencyKey` | the delivery id | `(event) => string \| undefined` |
| `concurrencyKey` | `<owner>/<repo>#<issue or pull request number>`, else `<owner>/<repo>` | `(event) => string \| undefined`; runs on one issue wait for each other |

`github.on()` subscribes to the channel named `github`; a second channel makes its subscriptions with its own `channel.on()`. The run payload is a `GithubEvent { name, action?, delivery, installationId?, payload }`, where `payload` is the full GitHub body. A derived key above 255 characters or with a NUL fails that agent like a throwing `filter` (see *Failures*).

## Outbound: comments

The channel's `out` comments on an issue or pull request. Tools reach it through core: `ctx.channels.findOne()` answers on the issue of a run the channel started, `ctx.channels.findOne('github')` emits to any issue (`github.to({ repo, number })` builds the address `<owner>/<repo>#<number>`):

```ts
import { defineTool } from '@chamvi/core';
import { github } from '@chamvi/github';

const answer = defineTool({
    description: 'Answer on the issue.',
    inputSchema: z.object({ body: z.string() }),
    async execute({ body }, { context }) {
        await context.channels.findOne()?.emit({ body });
        await context.channels.findOneOrFail('github').emit({ title: 'Triage log', body }, github.to({ repo: 'octo/ops', number: 1 }));
        return 'sent';
    },
});
```

Per message the channel:

1. parses the address (anything but `owner/repo#n` is a `ValidationError`) and picks the installation: the event's for a run this channel started, else `installationId` from `createGithubApp()`; without one it throws `InvalidAgentDefinitionError` before any request,
2. lists the issue's comments updated since the run's `receivedAt` minus one hour and returns when one by the App bot (`<slug>[bot]`, compared case-insensitively) holds the marker `effectMarker(message.key)`,
3. else posts the comment: the `mention` logins, `### <title>` (when given), the body in a fence, for an approval the approval line, the run line and the marker:

````md
@octocat

### Close this issue?

```
{ "repo": "octo/demo", "number": 7 }
```

Waiting for approval until 2026-10-22T09:00:00.000Z. Approve or deny: https://chamvi.example/ui/approvals?run=<runId>&approval=<approvalId>
Run `<runId>` of agent `triage`.

<!-- chamvi:effect=<runId>:<approvalId> -->
````

The message key (an `emit`'s content-addressed key, an approval's `<runId>:<approvalId>`) goes into the marker as is; a key with characters an HTML comment cannot hold (`--`, whitespace) or over 255 characters is replaced by `sha256:<hex>`. A lost response is therefore harmless: the next attempt finds the comment. Every failure throws a `ChamviError` with code `github_request` (`GitHub <status>: <message>`), as does a GitHub that does not answer within `timeoutMs` (30 s, for the comment list and the post; the token exchange and `GET /app` are bounded by the App itself); an abort of the caller's signal rejects with its reason.

## Approvals

Gate a tool in the agent's `hooks.beforeToolExecution` with a durable `approve()`, as the usage example does for `github_close_issue`: `ctx.channels.findOneOrFail('github').approve({ title, body })` pauses the run, and the engine delivers the request as one comment on the run's issue (key `<runId>:<approvalId>`, re-sent by `tick()` until it went out, never twice). The owner answers in the chamvi UI (`approvalUrl` links there) or through `POST /runs/:id/approve`; the call then runs again from the start and `approve()` returns the decision. `approve(ctx, { title })` from core asks without a comment (inbox and API only).

## Tools

Every tool acts as an installation: the delivery's for a run the `github` channel started, else `installationId` from `createGithubApp()` (cron, REST and MCP runs). Without either, a tool fails the run (`FatalToolError`). Inputs name the repository as `owner/name` (GitHub's name characters; `.` and `..` are refused). Every installation request carries the run's signal, so cancel, drain and the run timeout abort a stalled GitHub call. The App-authenticated requests (the token exchange and `GET /app` for the bot login) are shared by every waiting run and delivery, so they carry no run's signal; each is aborted after 30 s on the app's clock instead, and the next caller retries. A failed GitHub call reaches the model as `GitHub <status>: <message>`, never with the request or its token.

| Tool | Kind | Input | Result |
|---|---|---|---|
| `github_get_issue` | read | `repo`, `number` | `number`, `title`, `body`, `state`, `labels`, `author`, `url`, `createdAt`, `comments`, `isPullRequest` |
| `github_search_issues` | read | `query`, `limit?` (1 to 20, default 10) | `total`, `items: [{ repo, number, title, state, url }]` |
| `github_list_labels` | read | `repo` | `[{ name, description }]`, every page |
| `github_get_pull_request` | read | `repo`, `number` | `number`, `title`, `body`, `state`, `draft`, `merged`, `base`, `head`, `author`, `url`, `changedFiles` |
| `github_get_file` | read | `repo`, `path`, `ref?` | `{ path, size, content, truncated }` (cut at 65 536 characters) or `{ path, entries }` for a directory |
| `github_get_latest_release` | read | `repo` | `{ tag, name, publishedAt, url, body }` or `{ none: true }` |
| `github_add_labels` | effect | `repo`, `number`, `labels` (1 to 20) | `{ labels }`: once per run and input (labels are a set) |
| `github_create_comment` | effect | `repo`, `number`, `body` | `{ id, url }`: **one comment per issue per model step** |
| `github_close_issue` | effect | `repo`, `number`, `reason?` (`completed`, `not_planned`) | `{ number, state, stateReason }`; an issue already closed is not patched again |

The write tools are effect tools (`defineEffectTool` from core). `github_create_comment` keys its effect by run, issue and model step (`<runId>:github_create_comment:<owner>/<repo>#<n>:<step>`, owner and repo lower-cased since GitHub resolves them case-insensitively) and embeds the key as a hidden marker (`<!-- chamvi:effect=... -->`). When the effect record is lost (a crash between GitHub accepting the comment and the checkpoint), the redone step finds the App's own comment with that marker (comments updated since the run was received, less an hour) and returns it instead of posting again, although the model wrote a different text. A second call for the same issue in the same step returns the first comment, so the tool description asks the model to put everything for one issue into one comment.

Gate destructive tools (`github_close_issue`) with an approval in `hooks.beforeToolExecution`, see [Approvals](#approvals).

## Security

- Installation tokens are cached per installation and replaced five minutes before they expire, so a run resumed hours later after an approval gets a fresh one. Tokens, the private key and JWTs are never logged and never stored in a run, step or effect.
- The tools reach every repository the installation can reach. An issue body is untrusted input: a model steered by it can act on any of those repositories, so install the App only where the agent may act, and gate destructive tools with approvals.
- The approval comment is public to everyone who can read the issue. With `approvalUrl` it links to the approval in the chamvi UI (run and approval id only), where the owner signs in (`agent:<agent>:approve` to answer, `run:read` or `agent:<agent>:run` to see the run); without it, the line says to answer in the UI or through `POST /runs/:id/approve`.
- The message body sits in a fence one backtick longer than any backtick run in it, so a `@login`, `@org/team` or `#123` inside notifies nobody and cross-links nothing, and no input closes the fence. Backtick runs over 31 are broken with U+200B zero-width spaces first, so the fence stays short; the body is cut to 60 000 characters (GitHub refuses comments over 65 536), never inside a surrogate pair. The title's whitespace runs are collapsed to one space. Only the configured `mention` logins are notified, and a comment by anyone but the App bot that copies a marker does not count as sent.
- `requireToolPermission()` from `@chamvi/core` denies every tool to runs without an invoker, and delivery runs have none. GitHub agents use `requireToolPermission({ withoutInvoker: 'allow' })` or wrap it.
- Webhook secrets can be rotated: pass `webhookSecret: [old, new]` while GitHub switches over.

## Git credentials for workspaces

`githubAppCredentials(app, { permissions? })` lets the workspaces of `@chamvi/sandbox` check out and push the App's repositories with short-lived tokens limited to the one repository: `contents: read` to read, `contents: write` plus `permissions` to push. It answers nothing for another host or a repository the App is not installed on, so the next source (or an anonymous checkout) follows. It is typed structurally, so this package does not depend on `@chamvi/sandbox`.

```ts
const workspaces = createWorkspaceManager({
    provider,
    credentials: githubAppCredentials(gh, { permissions: { workflows: 'write' } }),
    author: await gh.botIdentity(), // { name: '<slug>[bot]', email: '<id>+<slug>[bot]@users.noreply.github.com' }
});
```

`gh.repositoryToken({ owner, repo }, { permissions })` is the same token for your own code, cached until 5 minutes before it expires.

## Context

`provideGithubContext(engine, gh)` provides the App on the engine; a tool or a tools factory reads it with `injectGithubContext(ctx)`, so the tools need no closure over the instance:

```ts
import { injectGithubContext, provideGithubContext } from '@chamvi/github';

const triage = defineAgent({
    name: 'triage',
    model,
    instructions: 'Label the issue.',
    tools: (ctx) => injectGithubContext(ctx).readTools(),
});

provideGithubContext(engine, gh); // once, after new Engine()
```

A missing App throws `ContextNotProvidedError` naming `github` (in the factory the run fails before any model call).

## With @chamvi/app

`githubModule({ channel? })` from `@chamvi/github/module` builds the App from `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_SLUG` and `GITHUB_API_URL` when it is called (`.app` at once), contributes `githubChannel()` (the `channel` options, the approval link from `CHAMVI_PUBLIC_URL` unless `channel.approvalUrl` is given, the app's clock) to the app's channels, which the http module serves at `/channels/github`, contributes `githubAppCredentials()` (the `credentials` options; `credentials: false` turns it off) for `sandboxModule()`'s workspaces, and provides the App on the engine. `@chamvi/app` is an optional peer; the main entry never imports it.

```ts
import { createApp } from '@chamvi/app';
import { githubModule } from '@chamvi/github/module';

export default createApp({ agents: [triage], modules: [githubModule()] });
```

## Options

`createGithubApp(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `appId` | `string \| number` | required | The App id |
| `privateKey` | `string` | required | PEM (PKCS#1 or PKCS#8); literal `\n` sequences become newlines |
| `webhookSecret` | `string \| string[]` | required | A delivery verifies under any of them |
| `installationId` | `number` | none | For runs not started by a delivery, and comments on their behalf |
| `slug` | `string` | `GET /app` once | The App's slug as in `github.com/apps/<slug>` (lower case), for the bot login `<slug>[bot]` |
| `baseUrl` | `string` | `https://api.github.com` | GitHub Enterprise Server: `https://<host>/api/v3` (absolute https URL; empty means the default) |
| `clock` | `IClock` | `systemClock` | Token expiry and JWT times |
| `fetch` | `typeof fetch` | global `fetch` | Every GitHub request |

`createGithubApp` throws `InvalidAgentDefinitionError` for an empty `appId`, a key that is no RSA private key, an empty secret, an `installationId` that is no positive integer, a `baseUrl` that is no absolute https URL (or has a query or hash) and a `slug` that is not the App's lower-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, as in `github.com/apps/<slug>`; a miscased one would silently disable the self guard).

`githubChannel(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `app` | `IGithubApp` | required | From `createGithubApp()` |
| `name` | `string` | `'github'` | The channel name (agent-name rules), served at `/channels/<name>` |
| `mention` | `string \| string[]` | none | Logins (without `@`) mentioned at the top of every comment |
| `approvalUrl` | `({ runId, approvalId, agent }) => string` | none | A link to the approval in the chamvi UI, e.g. `https://<app>/ui/approvals?run=<runId>&approval=<approvalId>`; it carries no token |
| `timeoutMs` | `number` | `30_000` | Bound of the comment list and the post, on the `clock` |
| `bodyLimit` | `number` | `1_048_576` | Bytes a delivery may have (`413` above) |
| `onError` | `(error) => void` | `console.error` | Each agent a delivery could not be dispatched to |
| `clock` | `IClock` | `systemClock` | Time source of the timeout |

Every option is checked when `githubChannel()` is called; a bad one throws `InvalidAgentDefinitionError`.

## API

| Export | Kind | Purpose |
|---|---|---|
| `createGithubApp` | function | The App: `octokit(installationId)`, `botLogin()`, `botIdentity()`, `repositoryToken()`, `verifySignature()`, `readTools()`, `writeTools()` |
| `githubAppCredentials` | function | Repository-scoped git credentials for `@chamvi/sandbox` workspaces |
| `DEFAULT_GITHUB_GIT_HOST`, `GITHUB_TOKEN_USERNAME` | constant | `'github.com'`, `'x-access-token'` |
| `githubChannel` | function | The channel: deliveries `in`, comments `out`, plus `on()` and `to()` bound to its name |
| `github` | object | `github.on(events, options?)` subscriptions and `github.to({ repo, number })` addresses for the channel named `github` |
| `GITHUB_CHANNEL_NAME`, `GITHUB_CHANNEL_TIMEOUT_MS`, `COMMENT_BODY_MAX_LENGTH` | constant | `'github'`, `30_000`, `60_000` |
| `DEFAULT_GITHUB_API_URL` | constant | `https://api.github.com` |
| `GITHUB_REQUEST_ERROR_CODE` | constant | `'github_request'`, the `code` of a failed GitHub request |
| `provideGithubContext`, `injectGithubContext` | function | Provide the App on the engine, read it from a `ToolContext` |
| `REPO_PATTERN` | constant | The `owner/name` pattern the tools accept (a regular expression source; `.` and `..` segments never match) |

Types: `GithubAppOptions`, `IGithubApp`, `GithubOctokit`, `GithubPermissions`, `GithubRepositoryToken`, `GithubBotIdentity`, `IGithubGitCredentials`, `GithubGitCredentialRequest`, `GithubGitCredential`, `GithubAppCredentialsOptions`, `GithubChannel`, `GithubChannelOptions`, `GithubApprovalRef`, `GithubEvent`, `GithubPayload`, `GithubSubscriber`, `GithubSubscriptionOptions`, `GithubTarget`, `GithubWebhookResult`, `GithubIssue`, `GithubIssueSearch`, `GithubLabel`, `GithubPullRequest`, `GithubFile`, `GithubDirectory`, `GithubRelease`, `GithubComment`, `GithubIssueLabels`, `GithubClosedIssue`.

`@chamvi/github/module`: `githubModule`, `GithubModule`, `GITHUB_MODULE_NAME`, types `GithubModuleOptions`, `GithubModuleChannelOptions`.

## License

Published under [Apache License 2.0](./LICENSE).
