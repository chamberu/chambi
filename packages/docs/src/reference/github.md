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
```

Throws `InvalidAgentDefinitionError` for an empty `appId`, a key that is no RSA private key, an empty webhook secret, an `installationId` that is no positive integer, a `baseUrl` that is no absolute https URL without query (empty means `https://api.github.com`) and a `slug` that is not the App's lower-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, as in the App's URL; a miscased one would silently disable the self guard).

<<< ../../../github/src/app/types.ts{ts}

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

<<< ../../../github/src/webhook/types.ts{ts}

## github.on, github.to

```ts
const github: GithubSubscriber; // github.on(events, options?), github.to({ repo, number }) for the channel named 'github'
```

`github.on()` throws `InvalidAgentDefinitionError` without events or for an event that is not `name` or `name.action` (lower case letters, digits and underscores, e.g. `projects_v2_item.created`). `github.to({ repo, number })` returns the address `<owner>/<repo>#<number>`.

<<< ../../../github/src/subscription/types.ts{ts}

## Tools

`gh.readTools()` and `gh.writeTools()` return plain AI SDK `ToolSet`s; the results are these shapes.

<<< ../../../github/src/tools/types.ts{ts}

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
