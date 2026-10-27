# GitHub App

`@chamvi/github` connects agents to a GitHub App through the `github` [channel](/guide/channels): a verified webhook delivery becomes one deduplicated run per matching agent, tools answer with issue comments, and the GitHub tools act as the App's installation. API: [@chamvi/github](/reference/github).

```bash
npm install @chamvi/github @chamvi/http @chamvi/core ai --save
```

## One App per agent repository

Each agent repository (and so each image) gets its own GitHub App, with its own webhook URL, App credentials and Secret. There is no shared intake router: an App's webhooks go straight to the app that owns it.

1. Create a GitHub App. Set the webhook URL to `https://<host><basePath>/channels/github` (the channel's name), the **content type to `application/json`** and a webhook secret. A hook created by hand defaults to `application/x-www-form-urlencoded`, which the channel answers with `415`.
2. Grant the permissions the tools use (for triage: issues read and write, pull requests read, contents read, metadata read) and subscribe to the events the subscriptions name.
3. Generate a private key and install the App on the repositories the agents may act on.

<<< @/snippets/github.ts#app

The private key may be PKCS#1 or PKCS#8; literal `\n` sequences become newlines, so a one-line env var works. Set `slug` in production: the self guard below then needs no `GET /app`.

## Agents and deliveries

<<< @/snippets/github.ts#agent

<<< @/snippets/github.ts#http

`github.on(events)` matches an event (`'issues'`, every action) or an event and action (`'issues.opened'`), then the optional `filter`. The run payload is a `GithubEvent { name, action?, delivery, installationId?, payload }` with the full GitHub body as `payload`.

`POST /channels/github` is the channel's `in`, mounted by the `channels` option of [`createHttpApp`](/guide/http#channels) (a second channel, `githubChannel({ name: 'github-ent' })`, is served at `/channels/github-ent`):

1. a missing `X-Hub-Signature-256` is `401`; a malformed `X-GitHub-Event` or `X-GitHub-Delivery` (1 to 255 characters) is `400`,
2. the body is read with the channel's `bodyLimit` (1 MiB by default; `413` above it, `415` for a non-JSON content type),
3. the `sha256=` HMAC of the **raw body bytes** must match under one of the webhook secrets (constant time), else `401`; a body that is not a JSON object is `400`,
4. every agent with a matching subscription of this channel gets one run (its first matching subscription), with the delivery id (`X-GitHub-Delivery`) as the idempotency key unless the subscription's `idempotencyKey(event)` says otherwise, by default `<owner>/<repo>#<number>` as the concurrency key, and for an event with an issue or pull request the address `<owner>/<repo>#<number>` (`run.address`),
5. events the App sent itself (`sender` is `<slug>[bot]` of `type: 'Bot'`) start no run, so the agent does not wake itself,
6. it answers `202 { delivery, runs: [{ agent, runId, deduplicated }] }` right away, also for `ping` and unmatched events; the runs happen asynchronously.

The channel route is rate limited like every route (300 per minute per client address by default) but not behind the app's authenticators: the signature is its credential.

::: warning The delivery id and the event name are not signed
`X-Hub-Signature-256` covers the body only, not `X-GitHub-Delivery` or `X-GitHub-Event`. A captured signed delivery replayed under a new delivery id, or under another event name an agent listens on, starts new runs, each spending model tokens. On an exposed endpoint, give the subscription an `idempotencyKey` built from body fields only (the action, the repository, the issue and its `updated_at`, never `e.name` or `e.delivery`), and a `filter` that checks the body carries what the event name implies (`issue` for `issues`, `comment` for `issue_comment`).
:::

::: warning GitHub does not redeliver failed deliveries
A failing agent (a throwing `filter` or key function, a key above 255 characters, a failed dispatch) does not stop the others; each failure goes to the channel's `onError` and the answer is `500`. GitHub never retries a `4xx` or `5xx` delivery by itself: redeliver it by hand (the App's *Advanced* tab) or through the redelivery API. A redelivery keeps the delivery id, so the agents that already got their run are deduplicated.
:::

Large `push` or `pull_request` deliveries can exceed the default `bodyLimit` of 1 MiB (GitHub sends up to 25 MB); raise `bodyLimit` on `githubChannel()` when an agent needs them. Two chamvi Apps on one repository see each other as ordinary bots: use a `filter` to break such loops.

## Comments out and approvals

The channel's `out` comments on an issue or pull request. `ctx.channels.findOne()` answers on the issue a run came from, `ctx.channels.findOne('github')` emits to any issue (`github.to({ repo, number })` builds the address `<owner>/<repo>#<number>`):

<<< @/snippets/github.ts#outbound

Before posting, the channel lists the issue's comments updated since the run's `receivedAt` minus one hour and returns when one by the App bot holds the marker `effectMarker(message.key)`, so a lost response never posts twice. The comment carries the `mention` logins, `### <title>`, the body in a fence one backtick longer than any run in it (so a `@login` or `#123` inside notifies nobody), for an approval the approval line, the run line and the marker. The installation is the event's for a run this channel started, else `installationId` from `createGithubApp()`.

An approval asked through the channel (`ctx.channels.findOneOrFail('github').approve(...)`, as the agent above does for `github_close_issue` in its `beforeToolExecution` hook) becomes one comment on the run's issue. With `approvalUrl` it links to the approval in the chamvi UI (run and approval id only), else it says to answer in the UI or through `POST /runs/:id/approve`. The comment is public to everyone who can read the issue. An approval with [options](/guide/approvals#offering-options) lists them after the body as `- <id>: <label>` under `Options (choose one):` (or `choose one or more`), fenced like the body, never with their details (those stay in the UI), and the link line reads `Choose and approve or deny: <link>`; the body is cut by the list's length, so the comment stays under GitHub's limit.

## Tools

Every tool acts as an installation: the delivery's for a run started by a delivery, else `installationId` from `createGithubApp()` (cron, REST and MCP runs); without either the run fails with `FatalToolError`. Installation tokens are cached per installation on the `clock` given to `createGithubApp()` (default `systemClock`, not the engine's), replaced five minutes before they expire (so a run resumed hours after an approval gets a fresh one) and never logged or stored. A failed GitHub call reaches the model as `GitHub <status>: <message>`, never with the request or its token. Every installation request carries the run's signal: cancel, drain and the run timeout abort a stalled call. The token exchange and `GET /app` are shared by every waiting run and delivery, so they are bounded by their own 30 s timeout on that same clock instead; a timed-out one is not cached and the next caller retries.

| Tool | Kind | Purpose |
|---|---|---|
| `github_get_issue` | read | One issue or pull request |
| `github_search_issues` | read | GitHub issue search, at most 20 results |
| `github_list_labels` | read | Every label of a repository |
| `github_get_pull_request` | read | One pull request with its branches |
| `github_get_file` | read | A file (cut at 65 536 characters) or a directory listing |
| `github_get_latest_release` | read | The latest release, or `{ none: true }` |
| `github_list_releases` | read | The releases between two versions (`v1.2.3` and `1.2.3` both match, `tagPrefix` for a monorepo), oldest first, at most 20, notes cut at 8 000 characters |
| `github_compare` | read | The commits (first lines, at most 100) and changed files (at most 300) between two refs, for a package without release notes |
| `github_add_labels` | effect | Adds labels (a set, so naturally idempotent) |
| `github_create_comment` | effect | One comment per issue per model step, found again by its marker |
| `github_close_issue` | effect | Closes an issue; meant to sit behind an [approval](/guide/approvals#gating-tools-you-did-not-write) in a `beforeToolExecution` hook |

Write tools are [effect tools](/guide/effect-tools). A comment embeds an [`effectMarker`](/guide/effect-tools#the-crash-window) keyed by run, issue and model step (`<runId>:github_create_comment:<owner>/<repo>#<n>:<step>`, owner and repo lower-cased since GitHub resolves them case-insensitively), and `alreadyApplied` looks for the App's own comment with that marker before posting. A crash between posting and recording redoes the model step with a different text, and the step-based key still finds the first comment, so nothing is posted twice. A second call for the same issue in the same step returns the first comment.

## Security notes

- The tools reach every repository the installation reaches. Issue text is untrusted input: a model steered by it can act on any of them. Install the App only where the agent may act and put destructive tools behind approvals (an agent hook calling `approve()`).
- [`requireToolPermission()`](/guide/tools#restricting-tools-per-invoker) denies every tool to runs without an invoker, which includes every delivery run. GitHub agents use `requireToolPermission({ withoutInvoker: 'allow' })` or wrap it.
- Sandboxes never get the App's credentials. A short-lived token scoped to one repository, for a sandbox that must push, is planned; the [workspaces](/guide/workspaces) shipped without it.
