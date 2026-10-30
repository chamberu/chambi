# @chamvi/github

The GitHub channel (webhook deliveries in, issue comments out) and GitHub tools for chamvi agents. The public API of `packages/github/src/index.ts`.

```bash
npm install @chamvi/github @chamvi/http @chamvi/core ai --save
```

`@chamvi/core`, `@chamvi/http` and `ai` are peer dependencies. See [GitHub App](/deployment/github-app) for setup and behaviour.

## createGithubApp

```ts
function createGithubApp(options: GithubAppOptions): IGithubApp;

const DEFAULT_GITHUB_API_URL: 'https://api.github.com';
const INSTALLATION_CACHE_TTL_MS: 600_000;
```

Throws `InvalidAgentDefinitionError` for an empty `appId`, a key that is no RSA private key, an empty webhook secret, an `installationId` that is no positive integer, a `baseUrl` that is no absolute https URL without query (empty means `https://api.github.com`) and a `slug` that is not the App's lower-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, as in the App's URL; a miscased one would silently disable the self guard).

<<< ../../../github/src/app/types.ts{ts}

`installationFor({ owner, repo })` answers the App's installation on a repository (App JWT, cached per lower-cased `owner/repo` for `INSTALLATION_CACHE_TTL_MS` on the clock, concurrent callers sharing one lookup; `undefined`, not cached, where the App is not installed); `repositoryInstallation({ owner, repo })` answers the whole installation of that lookup (`GithubInstallation`, permissions included) from the same cache; `installations()` lists every installation (`GET /app/installations`, not cached). `writeTools({ mergeMethod })` throws `InvalidAgentDefinitionError` for a method outside `MERGE_METHODS`.

```ts
const GITHUB_REQUEST_ERROR_CODE: 'github_request';
const REPO_PATTERN: string; // '^([\\w.-]*[\\w-][\\w.-]*)/([\\w.-]*[\\w-][\\w.-]*)$'
```

`GITHUB_REQUEST_ERROR_CODE` is the `code` of every failed GitHub request (the tools' errors and the channel's send failures); `REPO_PATTERN` is the `owner/name` rule the tools apply (GitHub's name characters, each segment with one that is not a dot, so `.` and `..` never fold the URL into another API path). Build a `RegExp` from it.

## githubChannel

```ts
function githubChannel(options: GithubChannelOptions): GithubChannel; // IChannel with in and out, plus on() and to() bound to its name

const GITHUB_CHANNEL_NAME: 'github';
const GITHUB_CHANNEL_TIMEOUT_MS: 30_000;
const COMMENT_BODY_MAX_LENGTH: 60_000;
```

<<< ../../../github/src/channel/types.ts#public{ts}

Every option is checked when `githubChannel()` is called (`InvalidAgentDefinitionError`). Register the channel on the engine and list it in `createHttpApp({ channels })`, which serves its `in` at `POST /channels/<name>` (the deliveries: signature, self guard, one run per matching agent, `202` with a `GithubWebhookResult`). Its `out(message, address)` comments on the issue or pull request `address` names (`owner/repo#n`, else a `ValidationError`), deduplicated by the marker `effectMarker(message.key)`. An approval with options lists them fenced as `- <id>: <label>` under `Options (choose one):` (or `Options (choose one or more):`), the body is cut by that block's length, and the link line reads `Choose and approve or deny: <link>`. See [GitHub App](/deployment/github-app) for both directions.

Send `emit({ body, slot: 'status' })` or `approve({ title, slot: 'status' })` to create/update one persistent comment per repository, issue/PR, channel, agent and named slot. `slot` must be a non-empty, well-formed Unicode string without NUL characters; omitting it appends an ordinary comment. A channel and agent can mix ordinary comments and multiple slots. Approval slots survive notification retries and recovery. `locks?: ILockRepository` coordinates slot lookup and write; standalone channels default to local memory, while `githubModule()` supplies the app store's locks when needed. A busy slot fails with `github_request` for retry. Persistent lookup has no time cutoff, requires the stable marker and App bot identity, and PATCH errors never create a replacement in the same attempt. See [persistent status comments](/deployment/github-app#persistent-status-comments) for replica and ordering limits.

<<< ../../../github/src/webhook/types.ts{ts}

## github.on, github.to

```ts
const github: GithubSubscriber; // github.on(events, options?), github.to({ repo, number }) for the channel named 'github'
```

`github.on()` throws `InvalidAgentDefinitionError` without events or for an event that is not `name` or `name.action` (lower case letters, digits and underscores, e.g. `projects_v2_item.created`), and for a `selfEvents` entry of that shape naming `issue_comment`, `issues` or `pull_request_review_comment` (the bot's own comment would start the agent again). A bot-sent delivery starts each agent's first matching subscription whose `selfEvents` name it; a bare `pull_request` there also takes the `labeled`, `closed` and `synchronize` deliveries the agent's own tools and pushes cause, so name the actions (`pull_request.opened`). A delivery the App's bot sent reaches only subscriptions whose `selfEvents` name its event. `github.to({ repo, number })` returns the address `<owner>/<repo>#<number>`.

<<< ../../../github/src/subscription/types.ts{ts}

## Tools

```ts
const DEFAULT_MERGE_METHOD: 'squash';
const MERGE_METHODS: readonly ['merge', 'squash', 'rebase'];
const MERGE_STATES: readonly ['clean', 'unstable', 'has_hooks'];
```

`gh.readTools()` (`github_get_issue`, `github_search_issues`, `github_list_labels`, `github_get_pull_request`, `github_get_file`, `github_get_latest_release`, `github_list_releases`, `github_compare`, `github_list_repositories`, `github_list_issues`, `github_list_pull_requests`, `github_get_pull_request_checks`, `github_get_push_target`) and `gh.writeTools(options?)` (`github_add_labels`, `github_create_comment`, `github_close_issue`, `github_create_issue`, `github_create_pull_request`, `github_merge_pull_request`) return plain AI SDK `ToolSet`s. Each tool acts as the installation of the repository it names: the delivery's for a run of the GitHub channel on that repository, else `installationFor()`, else the delivery's or `installationId` (a public repository the App is not installed on stays readable); without any a `github_request` tool error. `github_merge_pull_request` refuses with `ToolDeniedError`, before the merge request, a closed pull request, a head that moved from `sha`, a draft, a mergeability not computed yet, a `mergeable_state` outside `MERGE_STATES` any required check that is not green or has not reported, required checks it cannot read (a 403 or 404 on the branch or its rules, `required.known` false), a head without any check yet and any check still running; a failing check that is not required does not stop it. The results are these shapes.

<<< ../../../github/src/tools/types.ts{ts}

## Opt-in file proposals

`createGithubApp({ ..., proposals: { repos: { 'acme/agents': { paths: ['agents/**', 'skills/**'] } } } })` enables `github_propose_change` in `app.writeTools()`. Without `proposals`, `app.writeTools()` does not include it. `GithubAppOptions.proposals` uses `GithubProposalsOptions`; configuration is validated and copied at app construction.

The input is `GithubProposeChangeInput`: `{ repo, path, content, reason }`. It returns `{ number, url, base, head }` after creating or updating one stable branch and open PR for the agent/path, based on the repository's default branch. Every repository/path must match the configured allowlist; unsafe/ambiguous paths and `.github/**` are always refused before GitHub requests. There is no general file-write tool, automatic merge or local config hot reload. Review and merge through the existing PR flow; normal folder reload picks up merged configuration.

This is an outbound effect tool, subject to [untrusted-run approval](/guide/tools#untrusted-content-and-outbound-tools). The initial branch is `chamvi/<agent>/<path-slug>-<path-hash>`, and the fixed effect key `<runId>:propose:<repo>:<path>` permits one proposal per run/path. Later runs reuse its open PR. After closure or merge, new proposals use a fresh `-g-<previous-pr-number>` branch from the current default branch. Content already matching that base produces a no-change validation error, not an empty PR. Paginated commit ancestry reconciles lost effects without reverting newer content, including closed/merged PRs whose branches were deleted. Preserve proposal commits and PR ownership markers for recovery.

Pinned Git-tree reads reject symlinks, submodules and non-directory parents; regular-file executable mode is preserved. Diffs use observed base/head SHAs, include rename sources, and reject missing/truncated data and the 300-file comparison cap. Commits have the observed head as their sole parent and refs advance without force. Ref movement detected before or after PR publication fails closed, but can leave an already published PR to review.

**Exclusive tool ownership of proposal branches is required.** Serialize runs for the same agent/repository/path; external writes, force resets and deletion of active branches are unsupported. Checks cover an observed head, not an immutable branch. Ref updates and PR publication are not atomic, and no check guarantees future PR contents after its final observation. Review the current head before merging. GitHub App permissions must allow contents and pull-request writes. See the [package README's tools section](https://github.com/chamvi/chamvi/blob/master/packages/github/README.md#tools) for details.

Proposal reconciliation scans each historical PR independently and returns immediately on a matching run marker. A missing marker at GitHub's 250-commit PR cap fails closed. New updates stop at 249 commits: close or merge the proposal to allow a fresh generation. Already-capped historical PRs may require manual recovery. Unpublished branches are checked back to the pinned comparison's merge base, so independent base advancement does not invalidate proposal ownership.

## Content trust

The GitHub channel opts into untrusted ingress, and GitHub reads return untrusted content. Creating issues, pull requests and file proposals, merging, and commenting on another issue/PR are outbound. A comment on the source issue/PR is exempt. Adding only labels that already exist in the target repository is also exempt; introducing a new label name, or failing to resolve the repository's label vocabulary, remains outbound. Closing an issue is not classified outbound. Adding labels still taints the run: GitHub returns all labels on the issue, including externally controlled existing names. These destination/finite-label exemptions do not sanitize message content or replace authorization. See [Tools](/guide/tools#untrusted-content-and-outbound-tools) and [Approvals](/guide/approvals#automatic-outbound-gates).

## Git credentials

```ts
function githubAppCredentials(app: IGithubApp, options?: GithubAppCredentialsOptions): IGithubGitCredentials;

const DEFAULT_GITHUB_GIT_HOST: 'github.com';
const GITHUB_TOKEN_USERNAME: 'x-access-token';
```

The workspace manager's `credentials` source for the App (typed structurally against `@chamvi/sandbox`'s `IGitCredentials`, which this package does not depend on): for a request of its `host` (default `github.com`) and an `owner/name` path it answers `app.repositoryToken()` as `x-access-token`, with `contents: read` for read and `contents: write` plus `options.permissions` for write; nothing for another host, the host itself or a repository the App is not installed on, so the next source (or an anonymous call) follows. Throws `InvalidAgentDefinitionError` for an app without `repositoryToken`, permissions that are not `read` or `write` and a host that is no host name. `app.repositoryToken({ owner, repo }, { permissions })` finds the installation (`GET /repos/{owner}/{repo}/installation`, a 404 answers `undefined`) and exchanges a token with `repositories: [repo]`, cached per installation, repository and permissions until 5 minutes before it expires (one exchange for concurrent callers, failures not cached); `app.botIdentity()` is `{ name: '<slug>[bot]', email: '<user id>+<slug>[bot]@users.noreply.github.com' }` (one public `GET /users/<login>`), for the manager's `author`.

<<< ../../../github/src/credentials/types.ts{ts}

## Context

```ts
function provideGithubContext(provider: IContextProvider, app: IGithubApp): void; // engine.provide under the key 'github'
function injectGithubContext(ctx: ToolContext): IGithubApp;                    // else ContextNotProvidedError
```

`githubModule()` provides its app; with a hand-built engine call `provideGithubContext(engine, gh)` after `new Engine()`. Inject in a tools factory (`tools: (ctx) => injectGithubContext(ctx).readTools()`), in a tool's `execute` or in an effect hook; see [Context](/guide/tools#context-shared-instances-for-tools). One app per engine: a second provide throws `InvalidAgentDefinitionError`.

## Module

```ts
// @chamvi/github/module, needs @chamvi/app
function githubModule(options?: GithubModuleOptions): GithubModule; // name GITHUB_MODULE_NAME 'chamvi:github', .app: IGithubApp
```

Reads `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` (comma-separated), `GITHUB_INSTALLATION_ID`, `GITHUB_APP_SLUG` and `GITHUB_API_URL` from `options.env ?? process.env` when it is called, unless `options.app` is given; explicit options win. `setup` contributes `githubChannel()` (`options.channel`, the approval link from `CHAMVI_PUBLIC_URL` unless `channel.approvalUrl` is given, the app's clock) to the app's channels, which the http module serves at `/channels/<name>`, and `githubAppCredentials(app, options.credentials)` to `AppToken.GIT_CREDENTIALS`, which `sandboxModule()` asks after its own sources (`credentials: false` contributes none), and the `engineCreated` hook provides `.app`. `@chamvi/app` is an optional peer: the main entry never imports it. See [Apps & Modules](/guide/app#modules).

<<< ../../../github/src/module/types.ts{ts}
