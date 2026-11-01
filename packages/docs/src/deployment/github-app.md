# GitHub App

`@chamvi/github` connects agents to a GitHub App through the `github` [channel](/guide/channels): a verified webhook delivery becomes one deduplicated run per matching agent, tools answer with issue comments, and the GitHub tools act as the App's installation. API: [@chamvi/github](/reference/github).

```bash
npm install @chamvi/github @chamvi/http @chamvi/core ai --save
```

## Bursts and HTTP intake

A signed delivery may start runs for many repositories behind one ingress. By default the HTTP app shares one 300-per-minute, per-client-IP bucket between channel intake and REST. Without trusted-proxy configuration, every delivery can look like the ingress IP; even with correct forwarding, GitHub deliveries can share source IPs.

Use a separate finite channel policy when request protection is still wanted:

<<< @/snippets/concurrency.ts#finite-http

Or disable just the GitHub intake limiter, retaining REST's default protection:

<<< @/snippets/concurrency.ts#unlimited-http

Include **one** of these `httpModule()` instances alongside `githubModule()` in `createApp({ modules })`. A custom channel name must be used as the policy key. With a bare engine, pass the same `channelRateLimits` option to `createHttpApp({ channels: [channel], ... })`. Signatures, media-type checks and body-size limits remain enforced. See the [HTTP policy reference](/reference/http#channel-http-request-limits).

Only trust the actual ingress source addresses/CIDRs and ensure the ingress strips or replaces client-supplied forwarding headers. The example CIDR is not a recommendation for every cluster. Kubernetes Ingress or Helm settings do not configure the app's `trustProxy` automatically; avoid `trustProxy: true` on a publicly reachable app.

Pair intake policy with [agent and subscription execution caps](/guide/concurrency#shared-agent-and-subscription-ceilings). A successful `202` acknowledges runs stored for execution, not completed work; excess runs remain `queued`. This backlog has no storage bound. The default GitHub concurrency key still serializes each issue or pull request, regardless of the numerical cap.

GitHub does **not automatically redeliver failed webhook deliveries**, including `429` refusals. Monitor failed deliveries and arrange manual or automated redelivery, or reconcile through a scheduled sweep. Retries with the same delivery id deduplicate; an event rejected before dispatch was not queued.

## One App per agent repository

Each agent repository (and so each image) gets its own GitHub App, with its own webhook URL, App credentials and Secret. There is no shared intake router: an App's webhooks go straight to the app that owns it.

1. Create a GitHub App. Set the webhook URL to `https://<host><basePath>/channels/github` (the channel's name), the **content type to `application/json`** and a webhook secret. A hook created by hand defaults to `application/x-www-form-urlencoded`, which the channel answers with `415`.
2. Grant the permissions the tools use (for triage: issues read and write, pull requests read, contents read, metadata read; for a maintainer that merges and opens pull requests also pull requests read and write, checks read and commit statuses read, plus the events `pull_request`, `check_suite` and `check_run`) and subscribe to the events the subscriptions name.

::: warning Never let the App bypass protection
Do not add the App to a ruleset bypass list or a branch protection exception. `github_merge_pull_request` refuses unsafe merges itself, but GitHub reports a blocked pull request as `clean` to a token that may bypass, so protection would no longer stand between the model and the default branch.
:::
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

### Persistent status comments

Choose a persistent comment explicitly on each send with a named `slot`. Omitting `slot` keeps append-per-message behavior. One channel and agent can mix ordinary replies and multiple independent status comments:

```ts
const github = ctx.channels.findOneOrFail('github');

await github.emit({ body: 'Found another issue.' }); // ordinary comment
await github.emit({ body: 'Latest assessment...', slot: 'maintainer-status' });
await github.emit({ body: 'Current test results...', slot: 'test-results' });

const decision = await github.approve({
    title: 'Merge the dependency update?',
    body: 'Head abc123 is ready for review.',
    slot: 'maintainer-status',
});
```

The slot must be a non-empty, well-formed Unicode string without NUL characters so its name survives database storage unchanged; there is no implicit default slot. The GitHub App, repository, issue/PR number, channel name and agent are always part of its identity, so another App never updates the comment; two deployments sharing one App, channel name, agent and slot name do share it. Different agents and slots do not overwrite one another. An approval can deliberately replace a status message by naming the same slot, and its slot is stored durably for notification retries and recovery.

The first send creates a comment. Later sends find it across **all comment pages, without a time cutoff**, then PATCH the complete safely rendered body, including the current run, approval choices, expiry and UI link. Only the authenticated App bot's comments with the matching hidden stable marker qualify. A retry of the currently published message does not write again. Lookup or PATCH failures fail the send, never fall back to POST; if a comment is deleted, a later send discovers its absence and recreates it.

`githubModule()` automatically uses the app store's locks when a slotted message is sent. Include `storeModule()` for these sends; ordinary comments do not need it. For standalone `githubChannel({ app, locks: store.locks })`, pass the same lock repository to all replicas. Omitted `locks` uses channel-local memory, which does **not** coordinate separate instances or processes. A send that finds the slot busy waits for it, asking the lock again with backoff (50 ms, doubling to 1 s) within the send's `timeoutMs`; only a slot busy for the whole timeout fails with a retryable `github_request` error, and approval notification delivery retries through the engine as usual. The lock is released in the background once the send settled: a release that fails is reported to `onError` and never turns a delivered comment into an error, and the lease ends a release that never answers.

The lock covers lookup and mutation, with a lease twice `timeoutMs` and owner-qualified release. It prevents cooperative overlapping sends from creating duplicate comments, not writes from clients that ignore the shared lock or remote requests that survive cancellation/lease expiry. GitHub provides no atomic marker-based upsert. Updates follow delivery order, not PR head freshness: a retry of an older message after another update can restore the older content and approval link. Applications must serialize or cancel superseded work if freshness matters. Existing duplicate comments are not deleted.

The slotted lookup pages **every** comment of the issue or pull request (100 per request), since chamvi keeps no durable comment id. A thread with many thousand comments can outlast `timeoutMs` (30 s by default); raise it for such threads, or use ordinary comments there.

## Tools

Every tool acts as the installation of the repository it names: the delivery's for a run the GitHub channel started on that repository (no request), else the App's installation on it (`GET /repos/{owner}/{repo}/installation` with the App JWT, cached 10 minutes, so an App installed on several accounts and organisations reaches all of them from one run), else the delivery's or `installationId` from `createGithubApp()` (a public repository the App is not installed on stays readable). Without any the call is a `github_request` tool error, never a failed run. Installation tokens are cached per installation on the `clock` given to `createGithubApp()` (default `systemClock`, not the engine's), replaced five minutes before they expire (so a run resumed hours after an approval gets a fresh one) and never logged or stored. A failed GitHub call reaches the model as `GitHub <status>: <message>`, never with the request or its token. Every installation request carries the run's signal: cancel, drain and the run timeout abort a stalled call. The token exchange and `GET /app` are shared by every waiting run and delivery, so they are bounded by their own 30 s timeout on that same clock instead; a timed-out one is not cached and the next caller retries.

| Tool | Kind | Purpose |
|---|---|---|
| `github_get_issue` | read | One issue or pull request |
| `github_search_issues` | read | GitHub issue search, at most 20 results |
| `github_list_labels` | read | Every label of a repository |
| `github_get_pull_request` | read | One pull request with its branches, head sha and repository, labels and mergeability |
| `github_get_file` | read | A file (cut at 65 536 characters) or a directory listing |
| `github_get_latest_release` | read | The latest release, or `{ none: true }` |
| `github_list_releases` | read | The releases between two versions (`v1.2.3` and `1.2.3` both match, `tagPrefix` for a monorepo), oldest first, at most 20, notes cut at 8 000 characters |
| `github_compare` | read | The commits (first lines, at most 100) and changed files (at most 300) between two refs, for a package without release notes |
| `github_add_labels` | effect | Adds labels (a set, so naturally idempotent) |
| `github_create_comment` | effect | One comment per issue per model step, found again by its marker |
| `github_close_issue` | effect | Closes an issue; meant to sit behind an [approval](/guide/approvals#gating-tools-you-did-not-write) in a `beforeToolExecution` hook |
| `github_list_repositories` | read | Every repository of every installation, sorted, archived ones only when asked, at most 1 000 |
| `github_list_issues` | read | The open issues of a repository (pull requests left out), at most 100 |
| `github_list_pull_requests` | read | The open pull requests with author type, head sha and repository (fork or not) and labels, at most 100 |
| `github_get_pull_request_checks` | read | Check runs and commit statuses of the head with the required ones; `none` until something reported, `pending` while a required check is missing |
| `github_get_push_target` | read | Whether the App can push onto a pull request's branch (never onto a fork it is not installed on) |
| `github_create_issue` | effect | Opens an issue, found again by its marker |
| `github_create_pull_request` | effect | Opens a pull request (`branch` or `owner:branch`, base default the default branch), found again by its marker |
| `github_merge_pull_request` | effect | Merges at the checked head `sha`; refuses a moved head, a draft, an unknown or blocked `mergeable_state` and any required check that is not green, and never sends a bypass |

Write tools are [effect tools](/guide/effect-tools). A comment embeds an [`effectMarker`](/guide/effect-tools#the-crash-window) keyed by run, issue and model step (`<runId>:github_create_comment:<owner>/<repo>#<n>:<step>`, owner and repo lower-cased since GitHub resolves them case-insensitively), and `alreadyApplied` looks for the App's own comment with that marker before posting. A crash between posting and recording redoes the model step with a different text, and the step-based key still finds the first comment, so nothing is posted twice. A second call for the same issue in the same step returns the first comment.

## Approvals in event-started runs

The GitHub channel is untrusted ingress: every run a delivery starts is tainted from its first step (issue text is written by strangers). `github_create_issue`, `github_create_pull_request`, `github_merge_pull_request` and `github_propose_change` are classified `guardWhenTainted`, so in such a run each of them waits for an [approval](/guide/approvals#automatic-outbound-gates) before it runs, and the source issue gets a generic "An outbound operation requires review" comment (never the arguments). This is intended: a model steered by issue text should not open, merge or propose on its own. An agent whose own policy already decides (an auto-merge maintainer that checks authors and checks itself) opts out per tool:

```ts
defineAgent({
    // ...
    trust: {
        tools: {
            github_merge_pull_request: { guardWhenTainted: false },
            github_create_pull_request: { guardWhenTainted: false },
        },
    },
});
```

Two more tools are gated conditionally, so expect their approvals too: `github_create_comment` waits when it targets any issue or pull request other than the run's source one (a comment on the source issue goes through), and `github_add_labels` waits when it adds a label name the repository does not have yet (or when the label lookup fails). Both take the same `trust.tools` override.

The override is a boolean per tool name; `trust.onTainted: 'deny'` refuses instead of asking. See [Tools](/guide/tools#untrusted-content-and-outbound-tools).

## Security notes

- The tools reach every repository the installation reaches. Issue text is untrusted input: a model steered by it can act on any of them. Install the App only where the agent may act and put destructive tools behind approvals (an agent hook calling `approve()`).
- [`requireToolPermission()`](/guide/tools#restricting-tools-per-invoker) denies every tool to runs without an invoker, which includes every delivery run. GitHub agents use `requireToolPermission({ withoutInvoker: 'allow' })` or wrap it.
- Sandboxes never get the App's credentials. A short-lived token scoped to one repository, for a sandbox that must push, is planned; the [workspaces](/guide/workspaces) shipped without it.
