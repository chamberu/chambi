# Project Structure

## Directory Layout

```
chamvi/
├── packages/
│   ├── core/                        # @chamvi/core
│   │   ├── src/                     # Library source (entry: src/index.ts), one folder per module
│   │   ├── test/
│   │   │   ├── vitest.config.ts     # Aliases @chamvi/core to ../src/index.ts
│   │   │   ├── unit/                # *.spec.ts, one folder per src module (agent/, engine/, ...)
│   │   │   ├── fixtures/            # readme-example.ts (the README example, run as a test)
│   │   │   └── utils/               # mock-model.ts, clock.ts (private ControllableClock copy)
│   │   ├── README.md                # Package README (must contain the fixture verbatim)
│   │   ├── tsdown.config.ts         # Builds dist/index.mjs + .d.mts
│   │   ├── tsconfig.json            # src + test (typecheck)
│   │   └── tsconfig.build.json      # src only (build:types)
│   ├── channel-cron/                # @chamvi/channel-cron (same layout; aliases core, test-kit and itself to src)
│   ├── http/                        # @chamvi/http (same layout; aliases core, test-kit and itself to src)
│   ├── test-kit/                    # @chamvi/test-kit (same layout; aliases core and itself to src)
│   ├── github/                      # @chamvi/github (same layout; aliases core, http, test-kit, itself and its /module, app, app/testing, channel-cron, store-typeorm to src)
│   │   └── test/fixtures/deliveries/ # Recorded GitHub webhook bodies (issues.opened, a bot's issue_comment)
│   ├── channel-openclaw/            # @chamvi/channel-openclaw (aliases core, test-kit, itself and its /module, plus app, app/testing, http, channel-cron, store-typeorm; fake gateway in test/utils/openclaw.ts)
│   ├── sandbox/                     # @chamvi/sandbox (same layout; aliases core, itself and its /module, sandbox-local, app, app/testing, http, channel-cron, store-typeorm; private test/utils/clock.ts)
│   ├── sandbox-local/               # @chamvi/sandbox-local (aliases core, sandbox, test-kit and itself)
│   ├── sandbox-docker/              # @chamvi/sandbox-docker (same aliases as local)
│   │   └── test/global-setup.ts     # dockerode ping() gate, builds images/sandbox-node as chamvi/sandbox-node:test
│   ├── sandbox-k8s/                 # @chamvi/sandbox-k8s (same aliases; tests drive a fake IPodClient, test/utils/client.ts)
│   ├── coding/                      # @chamvi/coding (aliases core, sandbox, sandbox-local, test-kit and itself)
│   ├── tool-web/                    # @chamvi/tool-web (aliases core, test-kit and itself; fake transport, fetch and lookup in test/utils/web.ts)
│   ├── ui/                          # @chamvi/ui (aliases core, http, test-kit, itself and its /module, plus app, app/testing, channel-cron, store-typeorm to src)
│   │   ├── src/                     # Node entries (tsdown -> dist/index.mjs: uiRoutes(); dist/module.mjs: uiModule())
│   │   ├── app/                     # The SPA (Vite root -> dist/app), own tsconfig for vue-tsc
│   │   └── test/{unit,e2e}/         # Vitest (routes, app modules), Playwright smoke spec + demo server
│   ├── app/                         # @chamvi/app (aliases every workspace package it imports, itself and its subpaths to src)
│   │   ├── src/                     # main entry src/index.ts, subpath entries src/{authup,testing}/index.ts
│   │   └── test/                    # global-setup.ts (postgres:18-alpine via testcontainers), utils/harness.ts (aliases @chamvi/app/testing's harness)
│   ├── cli/                         # @chamvi/cli (bin chamvi -> dist/cli.mjs; aliases app and its imports to src)
│   │   ├── src/cli.ts               # the bin (shebang, then the header)
│   │   └── test/fixtures/           # apps the commands and the spawned bin run: app (README), failing, hang, slow, keyless, broken
│   ├── store-typeorm/               # @chamvi/store-typeorm (same layout)
│   │   ├── src/{entities,migrations,schema,store}/
│   │   └── test/global-setup.ts     # Starts postgres:18-alpine via testcontainers for the suite
│   └── docs/                        # @chamvi/docs (private, not released): VitePress site (npm run docs:dev / docs:build)
│       ├── src/.vitepress/          # config.mts, theme/ (Tailwind v4 tokens, Layout.vue), components/{home,layout}/
│       ├── src/public/              # logo.svg (favicon), fixed light/dark logo and run-lifecycle copies
│       └── src/snippets/            # Code samples included via <<<, type-checked by the docs typecheck
├── images/
│   └── sandbox-node/                # Dockerfile + README of ghcr.io/chamvi/sandbox-node (Node 24, git, tini, uid 1000)
├── .github/
│   ├── assets/                      # logo.svg (+ test-kit and organisation variants), run-lifecycle.svg
│   ├── actions/{install,build}/     # Composite actions
│   ├── workflows/{ci,release,docs,images}.yml # CI (Node 22, 24, plus the Chromium e2e job), release-please + npm publish, docs to GitHub Pages, sandbox image (craneship, amd64 + arm64)
│   ├── ISSUE_TEMPLATE/              # Bug report and feature request templates
│   ├── FUNDING.yml                  # GitHub Sponsors
│   └── dependabot.yml               # Daily npm + github-actions updates, docker for images/sandbox-node
├── .husky/commit-msg                # Runs commitlint
├── CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
├── nx.json                          # Task orchestration and caching
├── tsconfig.json                    # Root config, path aliases for every package (@chamvi/core, @chamvi/sandbox, @chamvi/channel-*, ...) -> packages/*/src
├── tsconfig.build.json              # Shared compiler options
├── eslint.config.js                 # @tada5hi/eslint-config flat config
├── commitlint.config.mjs            # Conventional Commits
├── release-please-config.json       # One linked release for every package (linked-versions)
└── .release-please-manifest.json    # Current released versions
```

## Related Repositories

| Repo | Holds | Reference |
|------|-------|-----------|
| [chamvi/helm](https://github.com/chamvi/helm) | Chart `agent-app` (`oci://ghcr.io/chamvi/helm/agent-app`) | [references/helm.md](references/helm.md) |
| [chamvi/agent-template](https://github.com/chamvi/agent-template) | The starter app, its Dockerfile, CI and Flux examples | [references/agent-template.md](references/agent-template.md) |

## Packages

| Package | Status | Responsibility |
|---------|--------|----------------|
| `@chamvi/core` | Exists (0.1.0) | defineAgent, run engine (streaming, structured output, the live agent registry `putAgent`/`removeAgent` with revision markers), `provide`/`inject` context for tools (`defineContextKey`, `inject`, `tryInject`), checkpoints, the channel contract (`IChannel`, subscriptions, the envelope with `channel`/`address`, `EngineOptions.channels` started and stopped by the engine, `ToolContext.channels` (`findOne`, `findOneOrFail`, `find`) with effect-recorded `emit()`, `consoleChannel()`), durable `approve()` (suspend, pending tool calls, replay) and agent `hooks`, run artifacts, state API, budgets, the `IStore` interface, in-memory store |
| `@chamvi/test-kit` | Exists (0.1.0) | `ControllableClock`, `describeStoreContract()`, `describeWorkspaceContract()`, `createGitFixture()`, `createFakeGithub()` (in-process GitHub for `createGithubApp({ fetch })`); depends on core only (the workspace contract types `IWorkspace` structurally as `ContractWorkspace`: a sandbox edge would close a release-please cycle through app); core and sandbox never depend on it |
| `@chamvi/http` | Exists (0.1.0) | `createHttpApp()` (routup v6): REST control API, SSE run stream, the `httpChannel()`/`mcpChannel()`/`webhookChannel()` channels with `http.on()`/`webhook.on()`, the `/channels/<name>` mount (`channels` option), MCP endpoint, authenticators (static tokens, authup, oidc), health, metrics, `createShutdown()`; peer on core |
| `@chamvi/channel-cron` | Exists (0.1.0) | `cronChannel()` (start/stop around one locked hubwire component per cron subscription, live on `agents.changed`), `cron.on()`, `runJob()`; `createScheduler()` internal; depends on `hubwire` and `cron-parser`, peer on core |
| `@chamvi/store-typeorm` | Exists (0.1.0) | `TypeormStore`, entities, initial migration, `migrateStore`, `purgeExpired` |
| `@chamvi/sandbox` | Exists (0.1.0) | `ISandboxProvider`/`IWorkspace`/`IExecTransport` contracts, path, repo, ref, limit and env rules, output collector, `createRemoteWorkspace()`, `prepareWorkspace()`, the run-scoped `createWorkspaceManager()` with `create_workspace`/`dispose_workspace`, the context pair `provideSandboxContext`/`injectSandboxContext`; `/module`: `sandboxModule()` (optional peer on `@chamvi/app`, the providers optional peers loaded by variable specifier); depends on `smob`, peer on core and `ai` |
| `@chamvi/sandbox-local` | Exists (0.1.0) | `createLocalSandbox()`: temp directory + spawn, no isolation; peer on core and sandbox |
| `@chamvi/sandbox-docker` | Exists (0.1.0) | `createDockerSandbox()`: one hardened container per workspace; depends on `dockerode` + `@types/dockerode`, `smob`, peer on core and sandbox |
| `@chamvi/sandbox-k8s` | Exists (0.1.0) | `createKubernetesSandbox()`, `createPodClient()`: one hardened pod per workspace; depends on `@kubernetes/client-node`, `smob`, peer on core and sandbox |
| `@chamvi/coding` | Exists (0.1.0) | `codingTools()` (read_file, write_file, edit_file, grep, list_files, bash, git_diff), the `ICodingBackend` contract; depends on `smob`, peer on core, sandbox and `ai` |
| `@chamvi/tool-web` | Exists (0.2.1) | `webTools()`: `web_fetch` (SSRF guard: resolve, check every address, connect to the checked one; manual redirects; caps and offset paging; HTML to markdown via turndown), `package_info` (npm, PyPI, crates.io, Packagist, Go module proxy, RubyGems), `web_search` over an `ISearchProvider`; depends on `turndown`, `@mixmark-io/domino`, `smob`, peer on core and `ai` |
| `@chamvi/ui` | Exists (0.1.0) | `uiRoutes()`: serves the prebuilt Vue 3 + vuecs dashboard (runs, run detail, approvals, agent state, schedules) as one extra route of `createHttpApp({ routes })`; `/module`: `uiModule()` (optional peer on `@chamvi/app`); peer on core and http (types only), every SPA library a bundled devDependency |
| `@chamvi/app` | Exists (0.1.0) | `createApp()` (`IApp`: `start`, `stop`, `runJob`, `migrate`), built-in orkos modules (config, store, static tokens, engine (every `AppToken.CHANNELS` contribution), agents (the `CHAMVI_AGENTS_DIR` folder loader and watcher), scheduler (the cron channel), http (the http, mcp and webhook channels, the `/channels` mount), plus the optional `consoleChannelModule()`) over an eldin container, `AppToken`s, env readers, `readConfig()`, the JSON line logger, the model registry; the module contract (tokens, `ModuleName`, env readers, `approvalUrlOf`, `AppContext`, `ILifecycleHook`, the orkos `IModule` and eldin `IContainer` types); subpaths `/authup` (`authupModule`, `oidcModule`) and `/testing` (`buildModuleHarness()`, `createModuleHarness()`), the other optional modules live in their feature packages on `/module`; re-exports core and part of http; depends on core, http, channel-cron, store-typeorm, `orkos`, `eldin`, `envix`, `routup`, `smob`, `locter`, `jiti`, `validup`, `@ebec/core`, peer on `ai`, `typeorm`, `pg` (optional: the AI SDK provider packages and the two `@authup/*` packages; no `@chamvi/*` feature package in any dependency field) |
| `@chamvi/cli` | Exists (0.1.0) | The `chamvi` bin (citty): `dev`, `build`, `start`, `run-job`, `migrate`, entry loading, signals, exit codes `0/1/2`; `runCli()`; depends on `citty`, peer on app (optional `tsdown`) |
| `@chamvi/coding-claude-code` | Planned | Claude Code coding backend |
| `@chamvi/github` | Exists (0.1.0) | `createGithubApp()` (App JWT, `IClock` installation-token cache, Octokit per installation), `githubChannel()` (`in`: the signed deliveries, one run per matching agent with the address `<owner>/<repo>#<n>`; `out`: one comment per key, deduplicated by `effectMarker()` found before posting), `github.on()`, `github.to()`, read tools and effect write tools, the context pair `provideGithubContext`/`injectGithubContext`; `/module`: `githubModule()` (optional peer on `@chamvi/app`; contributes the channel); depends on `@octokit/core` + `plugin-paginate-rest`, `@ebec/http`, `smob`, peer on core and `ai` (http a devDependency for tests) |
| `@chamvi/channel-openclaw` | Exists (0.1.0) | `openclawChannel()` (out only): `POST <hooksPath>/agent` with `Idempotency-Key`, a deterministic message with the approval link, an `IClock` timeout; `/module`: `openclawModule()` (optional peer on `@chamvi/app`; contributes the channel); no runtime dependencies, peer on core |

The memory store lives inside `@chamvi/core` (no separate `store-memory` package), because every test needs it.

## Core Module Map (`packages/core/src`)

Every module is a folder with `module.ts`, `types.ts`, `asserts.ts`, `constants.ts` and an `index.ts` barrel as needed (see [conventions](conventions.md#file-organization)).

| Path | Purpose |
|------|---------|
| `errors/` | `ChamviError` (`base.ts`), one file per subclass, `ErrorCode` (`constants.ts`) |
| `context/` | `defineContextKey()`, `inject()`, `tryInject()` (`module.ts`), `ContextKey`, `IContextProvider` (`types.ts`), the key `WeakSet` and the ToolContext `WeakMap`: `registerContextKey()`, `isContextKey()`, `bindProvided()`, `providedOf()`, `contextKeyName()` (`asserts.ts`, internal); `ContextNotProvidedError` lives in `errors/context-not-provided.ts` |
| `agent/` | `defineAgent()`, `AgentDefinition`, `AgentHooks`, `ToolCallInfo`, `AgentRevision` (`types.ts`), name rules and budget defaults (`constants.ts`), `assertToolsContext()`, `assertNoNeedsApproval()` (`asserts.ts`, internal) |
| `trigger/` | `TriggerEnvelope` (`channel`, `address`), `Invoker` (`types.ts`), `assertTriggerKey()` (`key.ts`), `TRIGGER_KEY_MAX_LENGTH` (`constants.ts`), `normalizeEnvelope()` (public: the legacy `source`/`thread` read-back for stores), `toInvoker()`, `idempotencyScope()` (`asserts.ts`, internal) |
| `channel/` | `IChannel`, `ChannelRequest`, `ChannelContext`, `ChannelDispatchEnvelope`, `DispatchResult`, `ChannelMessage`, `ChannelSendOptions`, `ChannelSubscription`, `EmitMessage`, `ChannelHandle`, `ToolChannels`, `ConsoleChannelOptions` (`types.ts`); `consoleChannel()` (`console.ts`); `createChannelContext()`, `assertChannelName()`, `createToolChannels()` (`ToolContext.channels`), `createChannelHandle()` (the emit effect and `approve()` with a channel) (`asserts.ts`, internal); `ChannelNotFoundError` lives in `errors/channel-not-found.ts` |
| `artifact/` | `Artifact`, `ArtifactInput`, `IRunArtifacts` (`types.ts`); `ARTIFACT_URI_PREFIX` (`constants.ts`, internal); `createRunArtifacts()`, `storeArtifact()`, `attachmentIds()` (`module.ts`, the latter two internal); `isArtifactMediaType()` (`media-type.ts`, public); `assertArtifactInput()`, `toFilePart()`, `hydrateMessages()` (`asserts.ts`) |
| `run/` | `RunStatus` enum (`constants.ts`); `Run`, `RunStatusLiteral`, `Step`, `Checkpoint`, `WaitPoint`, `Budget`, `Usage` |
| `store/types.ts` | `IStore` and its parts (see architecture) |
| `store/memory/` | `MemoryStore` |
| `engine/` | `Engine` (`module.ts`: channel start/stop, `pause()`, `answer()`, `deliverApproval()`), `RunEvent`, `RunDelta`, `DispatchEnvelope`, `ApprovalAnswer`, `EngineStartOptions` (`types.ts`), `budget.ts` (stop conditions), `queue/` (scheduler, the `prepareStart` guard), `execute/` (one streamed execution; `pendingToolCalls()`, `withoutResults()`, `withToolResults()`, `executePendingCall()` in `asserts.ts` run the calls an approval suspended), `registry/` (`withAgentLock()` in `asserts.ts`; `cancelAgentRuns()`, `syncRevision()`, `dropRevision()` in `module.ts`; `RegistryContext`; all internal), `AGENT_LOCK_TTL_MS` (`constants.ts`, internal), `AgentChange`, `EngineEvent` (`types.ts`) |
| `effect/` | `defineEffectTool()`, `effectMarker()` (`define.ts`), `wrapToolsForRun(tools, ctx, store, { allow?, hooks? })` (`wrap.ts`: the tool-call frame, hooks, effect lookup, `SuspendSignal` catch), `EFFECT`, `WrapToolsOptions`; `runToolCall()`, `currentToolCall()` (`frame.ts`, internal: the `AsyncLocalStorage` tool-call frame), `ToolCallFrame` (`types.ts`, internal) |
| `tool/` | `ToolContext` (`types.ts`), `toolContextSchema` (`constants.ts`), `defineTool()` (`define.ts`), `hasToolContext()` (`asserts.ts`, internal) |
| `approval/` | `approve()` and the internal `requestApproval()`, `SuspendSignal` (`request.ts`), `ApprovalRequestInput`, `ApprovalDecision` (`types.ts`), `DEFAULT_APPROVAL_TIMEOUT_MS`, `APPROVAL_TIMEOUT_MAX_MS` (public), `SUSPENDED_RESULT` (internal) (`constants.ts`), `approvalDecisionKey()`, `toApprovalDecision()` (`asserts.ts`, internal) |
| `permission/` | `matchesPermission()`, `hasPermission()`, `toolPermission()` (`match.ts`), `requireToolPermission()` (`policy.ts`), `RequireToolPermissionOptions` (`types.ts`), `PERMISSION_ALL` (`constants.ts`, internal) |
| `state/` | `createAgentState()` (`module.ts`, validation via `@validup/standard-schema`), generated tools (`tools.ts`) |
| `clock/` | `IClock`, `systemClock` |

`src/index.ts` re-exports each folder's `index.ts`. `@chamvi/test-kit` (`packages/test-kit/src`) holds `clock/` (`ControllableClock`), `store-contract/` (`describeStoreContract`), `workspace-contract/` (`describeWorkspaceContract`, `WorkspaceContractFactory`), `git-fixture/` (`createGitFixture`, `GitFixture`) and `github-fake/` (`createFakeGithub` in `module.ts`, `FakeGithub`, `FakeGithubOptions`, `FakeRequest`, `FakeRoute*`, `JwtClaims` in `types.ts`, the repository routes and `abortable()` in `asserts.ts`).

## Cron Channel Module Map (`packages/channel-cron/src`)

| Path | Purpose |
|------|---------|
| `channel/` | `cronChannel()` (`module.ts`: `start` builds the per-agent components and follows `agents.changed`, `stop` stops and awaits them, `on()` bound to its name), `CronChannel`, `CronChannelOptions`, `CronChannelErrorContext` (`types.ts`), `CRON_CHANNEL_NAME` (`constants.ts`), `markCronChannel()`, `isCronChannel()`, `assertCronChannelOptions()` (`asserts.ts`, internal) |
| `subscription/` | `cron` (`cron.on()`, the only export) and `createCronSubscription()` (`module.ts`, cron-parser and timezone validation), `OverlapPolicy`, `CronSubscriptionOptions`, `CronSubscriber` (`types.ts`), `OVERLAP_POLICIES` (`constants.ts`) |
| `lock/` | `createStoreScheduleLock()`: hubwire `IScheduleLock` over core's `ILockStore` |
| `tick/` | `fireCronSubscription()` (overlap check, envelope, dispatch), `readCronOptions()`; `isOverlapping()` in `asserts.ts` |
| `scheduler/` | `createScheduler()` (internal, the channel's engine), `assertSchedulable()` (public), `SCHEDULE_LOCK_TTL_MS`; `buildComponentOptions()`, `cronSubscriptionsOf()`, `buildAgentComponents()`, `toDefinitionError()` (`asserts.ts`, internal) |
| `run-job/` | `runJob()` (`start({ channels: false })`); `resolveCronSubscription()`, `isQueuedBehindApproval()` (`asserts.ts`), `SETTLING` (`constants.ts`), both internal |

## HTTP Module Map (`packages/http/src`)

Folders without an `index.ts` export nothing public; other modules import the file they need.

| Path | Purpose |
|------|---------|
| `app/` | `createHttpApp()` (`module.ts`), `HttpAppOptions` (incl. `channels`), the `HttpRoute*` types and the internal `HttpContext` (`types.ts`), defaults and `RESERVED_ROUTE_SEGMENTS` (incl. `channels`) (`constants.ts`), `buildContext()` (incl. `validateRoutes()`) and the JSON error handler (`asserts.ts`) |
| `auth/` | `Principal`, `Authenticator` (`types.ts`), `Permission` (`constants.ts`), `agentPermission()` (`module.ts`; permission matching is core's `hasPermission(principal.permissions, ...)`), `authenticate()`, `authorize()`, `readBearerToken()`, `toInvoker()` (`asserts.ts`, internal; display name from `name` or `preferred_username`, never `email`); `static-tokens/`, `authup/`, `oidc/` hold the built-in authenticators |
| `request/` | No barrel: `readJsonBody()`, `readRequestBody()` (public through `channels/`), `validateBody()`, `validatePayload()`, `decodeQuery()` (rapiq), `readIdempotencyHeader()`, `boundReceived()`, `boundIssues()` (`asserts.ts`); `KEY_MAX_LENGTH`, `RECEIVED_MAX_LENGTH` (`constants.ts`); validup validators `isString()`, `isBoolean()`, `isDefined()`, `isArrayOf()`, `isMediaType()`, `isBase64()` (`validators.ts`) |
| `health/` | No barrel: `/healthz`, `/readyz` |
| `runs/` | Run and artifact routes (`module.ts`), `serializeRun()`, `serializeStep()`, `canReadRun()`, `loadReadableRun()`, `loadRunArtifact()`, `contentDisposition()`, `assertCanListRuns()`, `parseRunListQuery()`, `loadApprovableRun()`, `createApproveContainer()` (`asserts.ts`), `MAX_ATTACHMENTS`, `APPROVAL_ID_MAX_LENGTH` (`constants.ts`, internal), `RunView`, `InvokerView`, `RunListQuery`, `ApproveBody` (`types.ts`); `stream/` holds `streamRun()` (SSE, incl. `delta`) |
| `channels/` | `httpChannel()`, `mcpChannel()` (`http.ts`), `webhookChannel()` (`webhook.ts`: the former hooks route as a channel `in`), `registerChannelRoutes()` (`module.ts`: `POST /channels/<name>{/*rest}` for the listed channels), `readRequestBody()` and `ReadRequestBodyOptions` (re-exported from `request/`), `WebhookChannel`, `WebhookChannelOptions` (`types.ts`), `HTTP_CHANNEL_NAME`, `MCP_CHANNEL_NAME`, `WEBHOOK_CHANNEL_NAME` (public), `CHANNELS_SEGMENT` (`constants.ts`); `validateChannels()`, `createChannelContext()`, `parseWebhookSubpath()`, `webhookUrl()`, `markWebhookChannel()`, `isWebhookChannel()` (`asserts.ts`, internal) |
| `subscriptions/` | `http` (`http.on()`, `http.ts`), `webhook` (`webhook.on()`) and `createWebhookSubscription()` (`webhook.ts`), `HttpSubscriptionOptions`, `HttpSubscriber`, `WebhookSubscriptionOptions`, `WebhookSubscriber` (`types.ts`) |
| `routes/` | No barrel: `registerRoutes()` serves `HttpAppOptions.routes` (extra routes of other packages; prefix routes, headers, byte bodies), `routeSubpath()` (`asserts.ts`) |
| `agents/` | `/agents`, `/schedules` and state routes (`module.ts`, incl. the KV listing via `parseKvListQuery()` in `asserts.ts`), `AgentSummary` (`channels: [{ channel, id, hook? }]`), `ScheduleSummary` (`types.ts`) |
| `me/` | `GET /me` (`registerMeRoutes()`, `module.ts`), `MeView` (`types.ts`, the only export) |
| `mcp/` | `createMcpEndpoint()`, `registerMcpRoutes()` (`module.ts`), the tools (`tools.ts`), `waitForRun()`, `toJsonSchema()` (`asserts.ts`), `RunSummary`, `RunToolResult` (`types.ts`) |
| `plugins/` | No barrel: `installPlugins()` (CORS, Prometheus, rate limit) |
| `shutdown/` | `createShutdown()`, `IShutdown`, `ShutdownOptions`, the timeout defaults |

## GitHub Module Map (`packages/github/src`)

| Path | Purpose |
|------|---------|
| `app/` | `createGithubApp()` (`module.ts`), `GithubAppOptions`, `IGithubApp`, `GithubOctokit` (`types.ts`), `DEFAULT_GITHUB_API_URL` (`constants.ts`), `PaginatedOctokit` and option normalizers (`asserts.ts`, internal) |
| `auth/` | No barrel: `createInstallationTokens()` (`module.ts`, token cache), `createAppJwt()`, `normalizePrivateKey()` (`asserts.ts`), `JWT_*`, `TOKEN_REFRESH_MARGIN_MS`, `GITHUB_USER_AGENT` (`constants.ts`) |
| `channel/` | `githubChannel()` (`module.ts`), the comment sender `createCommentSender()` (`out.ts`: marker reconcile, then the post), `GithubChannelOptions`, `GithubApprovalRef`, `GithubChannel` (`types.ts`, public region) and the internal `CommentTarget`, `ResolvedGithubChannelOptions`; `GITHUB_CHANNEL_NAME`, `GITHUB_CHANNEL_TIMEOUT_MS`, `COMMENT_BODY_MAX_LENGTH` (public) and `DEFAULT_BODY_LIMIT`, `CHANNEL_NAME_PATTERN`, `LOGIN_PATTERN`, `RECONCILE_SKEW_MS`, `SAFE_KEY_PATTERN`, `BACKTICK_RUN_MAX_LENGTH` (internal) (`constants.ts`); `resolveOptions()`, `parseAddress()`, `markerKey()`, `cutText()`, `fenceFor()`, `renderComment()` (`asserts.ts`) |
| `subscription/` | `github` (`github.on()`, `github.to()`), `createGithubSubscription()`, `githubAddress()` (`module.ts`), `GithubEvent`, `GithubPayload`, `GithubSubscriptionOptions`, `GithubTarget`, `GithubSubscriber` (`types.ts`), `GITHUB_EVENT_PATTERN` (`constants.ts`); `matchesGithubSubscription()`, `defaultConcurrencyKey()`, `eventAddress()` (`asserts.ts`, internal) |
| `webhook/` | `receiveDelivery()` (`module.ts`, internal: the channel's `in`), `verifySignature()`, `readHeaders()`, `toGithubEvent()`, `isJsonMediaType()` (`asserts.ts`), `EVENT_HEADER_PATTERN`, `SIGNATURE_PATTERN` (`constants.ts`), `GithubWebhookResult` (`types.ts`, the only export) |
| `tools/` | `createReadTools()` (`read.ts`, incl. `github_list_releases` and `github_compare`), `createWriteTools()` (`write.ts`), `installationIdOf()`, `parseRepo()`, `stepOf()`, `toolError()`, `withOctokit()`, `versionOf()`, `compareVersions()`, `versionBound()`, `cut()` and the input schema builders (`helpers.ts`), limits (`RELEASES_MAX`, `RELEASE_BODY_MAX_CHARS`, `RELEASE_PAGES_MAX`, `COMPARE_COMMITS_MAX`, `COMPARE_FILES_MAX`, `COMMIT_MESSAGE_MAX_CHARS`, `REF_PATTERN`, ...), `REPO_PATTERN` and `GITHUB_REQUEST_ERROR_CODE` (`constants.ts`; those two are exported), result shapes (`types.ts`) and the internal `RepoInput`/`NumberInput` |
| `context/` | `provideGithubContext()`, `injectGithubContext()` (`module.ts`), `GITHUB_CONTEXT` (`constants.ts`, internal; key `github`) |
| `module/` | The `/module` entry (the only folder importing `@chamvi/app`): `githubModule()`, `GithubModule` (`module.ts`; contributes `githubChannel()` to `AppToken.CHANNELS`), `createGithubAppFromEnv()` (`asserts.ts`), `GITHUB_MODULE_NAME` (`constants.ts`), `GithubModuleOptions`, `GithubModuleChannelOptions` (`types.ts`) |

## OpenClaw Channel Module Map

`@chamvi/channel-openclaw` (`packages/channel-openclaw/src/channel/`): `openclawChannel()` (`module.ts`, out only); `OpenclawChannelOptions`, `OpenclawApprovalRef`, `OpenclawDelivery`, `OpenclawHookBody` (`types.ts`, public between `#region public` markers the docs include) and the internal `ResolvedOpenclawOptions`; `OPENCLAW_CHANNEL_NAME`, `DEFAULT_HOOKS_PATH`, `OPENCLAW_TIMEOUT_MS`, `OPENCLAW_REQUEST_ERROR_CODE`, `MESSAGE_BODY_MAX_LENGTH` (public) and `HOOK_NAME`, `IDEMPOTENCY_KEY_MAX_LENGTH`, `ERROR_TEXT_MAX_LENGTH`, `APPROVAL_HINT` (internal) (`constants.ts`); `resolveOptions()`, `hookUrl()`, `renderMessage()`, `transportKey()`, `cutText()`, `redact()`, `fetchErrorMessage()`, `requestError()`, `responseError()` (`asserts.ts`). `module/` (the `/module` entry, the only folder importing `@chamvi/app`): `openclawModule()`, `OpenclawModule` (`module.ts`, name `chamvi:channel:<name>`, contributes the channel to `AppToken.CHANNELS`), `readDelivery()` (`asserts.ts`), `ERROR_PREFIX`, `VARIABLES` (`constants.ts`), `OpenclawModuleOptions` (`types.ts`). No context pair: tools use `ctx.channels.findOne(name)`.

## Sandbox Module Map (`packages/sandbox/src`)

| Path | Purpose |
|------|---------|
| `workspace/` | `IWorkspace`, `WorkspaceInfo`, `ExecOptions`, `ExecResult` (`types.ts`); `assertArgv()` (`module.ts`); `WORKSPACE_ROOT`, `OUTPUT_MAX_BYTES`, `FILE_MAX_BYTES`, `EXEC_TIMEOUT_MS`, `EXEC_TIMEOUT_MAX_MS`, `SANDBOX_ENV` (`constants.ts`) |
| `provider/` | `ISandboxProvider`, `WorkspaceCreateOptions`, `SandboxLimits` (`types.ts`); `DEFAULT_LIMITS`, `DEFAULT_SANDBOX_IMAGE`, `TMP_SIZE`, `SANDBOX_LABELS`, `SANDBOX_LABEL_SELECTORS`, `RUN_LABEL`, `WORKSPACE_LABEL`, `EXPIRES_AT_KEY` (`constants.ts`); the helpers every provider shares: `assertCreateInput()`, `abortedCreate()`, `assertImageOption()`, `assertClockOption()`, `buildWorkspaceInfo()`, `isExpiredAt()`, `collectionError()` (`module.ts`), `isName()` (`asserts.ts`, internal) |
| `clock/` | `delay()` (a wait on the `IClock` that rejects with the caller's abort error) |
| `limits/` | `resolveLimits()`, `parseCpu()`, `parseMemory()`, `assertSandboxEnv()` (`module.ts`); patterns and units (`constants.ts`, internal) |
| `output/` | `createOutputCollector()`, `createSinkStream()` (a `Writable` into an `IOutputSink`) (`module.ts`), `IOutputCollector` (`types.ts`), `completeLength()` (UTF-8 cut, `asserts.ts`) |
| `path/` | `resolveWorkspacePath()`, `absoluteWorkspacePath()` |
| `repo/` | `normalizeRepo()`, `assertGitRef()`, `prepareWorkspace()` (`module.ts`), `checkoutCommands()` and URL checks (`asserts.ts`, internal), `NormalizeRepoOptions` |
| `remote/` | `createRemoteWorkspace()` over an `IExecTransport` (`module.ts`), `wrapTimeout()`, `wrapExec()`, `exitMarker()`, `createExitMarkerFilter()`, `isTimeoutExit()`, output helpers (`asserts.ts`, internal), `TIMEOUT_KILL_AFTER_SECONDS`, `EXEC_GRACE_MS`, `ALIVE_PROBE_TIMEOUT_MS` (public), `EXIT_DRAIN_MS`, `EXIT_MARKER_CWD`, `EXEC_SCRIPT` and `WRITE_FILE_SCRIPT` (`constants.ts`, internal) |
| `manager/` | `createWorkspaceManager()` (`module.ts`), `createWorkspaceTools()` (`tools.ts`, internal), option checks and tool input helpers (`asserts.ts`), `MAX_WORKSPACES_PER_RUN`, `GC_INTERVAL_MS`, `CLOSE_TIMEOUT_MS` (`constants.ts`) |
| `context/` | `provideSandboxContext()`, `injectSandboxContext()` (`module.ts`), `SANDBOX_CONTEXT` (`constants.ts`, internal; key `sandbox`) |
| `module/` | The `/module` entry (the only folder importing `@chamvi/app`): `sandboxModule()`, `SandboxModule` (`module.ts`), `createLazyProvider()` (`provider.ts`), `isPackageNotFound()` (a copy of the app's), `loadPackage()` (`asserts.ts`), `SANDBOX_MODULE_NAME`, `SANDBOX_PROVIDER_NAMES` (public), `SANDBOX_PROVIDER_PACKAGES`, `SANDBOX_PROVIDER_IDS` (`constants.ts`), `SandboxModuleOptions`, `SandboxProviderName` (public region) and the structural provider package types (`types.ts`) |

`@chamvi/sandbox-local` (`packages/sandbox-local/src/provider/`): `createLocalSandbox()` (`module.ts`), `LocalWorkspace` (`workspace.ts`, spawn per exec in its own process group), `collectExpired()` (`gc.ts`), `buildEnv()`, `killGroup()`, `exitCodeOf()` (`asserts.ts`), `LOCAL_PROVIDER_NAME`, `REPO_DIR`, `WORKSPACE_RECORD`, `KILL_GRACE_MS` (`constants.ts`, internal; only `createLocalSandbox` is exported).

## Docker Sandbox Module Map (`packages/sandbox-docker/src`)

| Path | Purpose |
|------|---------|
| `provider/` | `createDockerSandbox()` (`module.ts`), `buildContainerOptions()`, `assertDockerOptions()`, `pullImage()`, `removeContainer()` (`asserts.ts`, internal), `DEFAULT_NETWORK`, `CONTAINER_NAME_PREFIX`, `SANDBOX_USER` (`constants.ts`), `DockerSandboxOptions` (`types.ts`) |
| `transport/` | No barrel: `createDockerTransport()`, the `IExecTransport` over the Docker exec API (demuxed streams into the workspace's sinks, exit code by inspect poll, `alive` by container inspect) |

## Kubernetes Sandbox Module Map (`packages/sandbox-k8s/src`)

| Path | Purpose |
|------|---------|
| `provider/` | `createKubernetesSandbox()` (`module.ts`), `buildPod()`, `podState()`, `assertKubernetesOptions()`, `loadDefaultKubeConfig()` (`asserts.ts`, internal), `CONTAINER_NAME`, `POD_NAME_PREFIX`, `START_TIMEOUT_MS`, `POLL_MS`, `FATAL_WAITING_REASONS` (`constants.ts`), `KubernetesSandboxOptions` (`types.ts`) |
| `client/` | `createPodClient()` (`module.ts`), `createPodClientFrom()` (`asserts.ts`, the test seam over `core`/`exec`), `IPodClient` and parts (`types.ts`), `STDIN_CLOSE_PROTOCOL` (`v5.channel.k8s.io`) |
| `transport/` | No barrel: `createPodTransport()`, the `IExecTransport` over `IPodClient.exec` (`alive` by pod read) |

## Coding Module Map (`packages/coding/src`)

| Path | Purpose |
|------|---------|
| `tools/` | `codingTools()` (`module.ts`); `read_file`, `write_file`, `edit_file` (`files.ts`), `grep`, `list_files` (`search.ts`), `bash` (`shell.ts`), `git_diff` (`git.ts`); input checks, `workspaceOf()`, `objectSchema()` (`asserts.ts`); `READ_MAX_LINES`, `READ_MAX_CHARS`, `SEARCH_MAX_RESULTS`, `LIST_MAX_RESULTS`, `LINE_MAX_CHARS` (public) and defaults (`constants.ts`); result types (`types.ts`) |
| `backend/` | `ICodingBackend`, `CodingTask`, `CodingResult`, `CodingBudget` (types only) |

## Web Tools Module Map (`packages/tool-web/src`)

| Path | Purpose |
|------|---------|
| `address/` | No barrel: `parseAddress()`, `isBlockedAddress()` (`module.ts`), `BLOCKED_IPV4`, `BLOCKED_IPV6` (`constants.ts`) |
| `request/` | `createRequester()` (`module.ts`: guard, manual redirects, caps, timeout), `pinnedTransport`, `fetchTransport()` (`transport.ts`), `requestError()`, `parseWebUrl()`, `hostOf()`, `systemLookup`, `checkedAddress()`, `messageOf()`, `readCapped()`, `discard()` (`asserts.ts`, internal), `WebAddress`, `WebLookup`, `WebUrlPolicy` (public region) and the internal `Transport`, `TransportInit`, `RequesterOptions`, `RequestOptions`, `WebResponse`, `Requester` (`types.ts`), `WEB_REQUEST_ERROR_CODE`, `MAX_REDIRECTS`, `WEB_TIMEOUT_MS`, `WEB_FETCH_MAX_BYTES` (public), `USER_AGENT`, `REDIRECT_STATUSES` (`constants.ts`) |
| `html/` | No barrel: `mediaTypeOf()`, `isHtml()`, `isText()`, `decodeBody()`, `htmlToMarkdown()`, `htmlToText()` (`module.ts`), `DROPPED_ELEMENTS`, `BLOCK_ELEMENTS`, `LINK_PROTOCOLS`, `TEXT_MEDIA_TYPES` (`constants.ts`) |
| `registry/` | `packageInfo()`, `PACKAGE_ECOSYSTEMS` (`module.ts`), one adapter per file (`npm.ts`, `pypi.ts`, `crates.ts`, `packagist.ts`, `go.ts` with `parseGoMod()`, `rubygems.ts`), `assertName()`, `assertVersion()`, `repositoryUrl()`, `licenseOf()`, `newestFirst()`, `versionDetail()`, `dependenciesOf()`, `compareSemver()` (`asserts.ts`), `PackageEcosystem`, `PackageInfo`, `PackageVersion`, `PackageVersionDetail`, `PackageDependency` (public region) and the internal `RegistryContext`, `RegistryAnswer`, `RegistryAdapter` (`types.ts`), `DEFAULT_REGISTRIES`, `PACKAGE_VERSIONS_MAX`, `PACKAGE_DEPENDENCIES_MAX` (public), `REGISTRY_MAX_BYTES`, `LICENSE_MAX_CHARS` (`constants.ts`) |
| `tools/` | `webTools()` (`module.ts`), `webFetchTool()` (`fetch.ts`), `packageInfoTool()` (`package.ts`), `webSearchTool()` (`search.ts`), `resolveOptions()` and input checks (`asserts.ts`), `WebToolsOptions`, `WebFetchFormat`, `WebFetchResult`, `ISearchProvider`, `SearchResult` (`types.ts`), `WEB_FETCH_MAX_CHARS`, `WEB_SEARCH_MAX_RESULTS` (public), `TIMER_MAX_MS`, `WEB_FETCH_FORMATS`, `UNTRUSTED_NOTE`, `WEB_SEARCH_DEFAULT_RESULTS`, `SNIPPET_MAX_CHARS` (`constants.ts`) |

## App Module Map (`packages/app/src`)

| Path | Purpose |
|------|---------|
| `app/` | `createApp()`, `isApp()` and the `App` class (`module.ts`, the lifecycle: one orkos `Application` over a fresh eldin `Container` per `start`/`runJob`/`migrate`, memoized `stop()`), `buildModules()` (built-ins replaced by name, duplicate names refused), `toSetupError()` (orkos graph errors as `InvalidAgentDefinitionError`), `createInUseError()`, `createStopFailedError()` (`asserts.ts`), `APP_BRAND` (`constants.ts`), `AppOptions`, `IApp` and the lifecycle option/result types (`types.ts`) |
| `module/` | `AppToken`, `ModuleName`, `AUTHENTICATOR_ORDER`, `APP_ERROR_CODE` (`constants.ts`), `runHooks()`, `throwIfStopped()`, `reportingModule()`, `createStoppedError()` (`asserts.ts`, the last two internal), `registerStartStep()`, `runStartSteps()` (`start.ts`, internal: the engine start (and so its channels') and the http serve step, run once every `onReady` built), `AppContext`, `ILifecycleHook`, `AuthenticatorEntry`, `Server`, `AppTokens` and the re-exported orkos `IModule` and eldin `IContainer` types (`types.ts`); with the env readers and `approvalUrlOf()` the module contract feature packages import from the main entry |
| `env/` | `TIMER_MAX_MS` (`constants.ts`), `envString()`, `envInteger()`, `envBoolean()`, `envUrl()`, `envList()`, `envJson()`, `envOneOf()` (`module.ts`, never echoing a value), `Env` and the reader options (`types.ts`) |
| `config/` | `readConfig(env, { mode, dev })` (`module.ts`), `readTokens()`, `approvalUrlOf()` (`asserts.ts`), defaults and patterns (`constants.ts`), `AppConfig`, `LogLevel`, `ReadConfigOptions`, `ApprovalRef` (`types.ts`) |
| `logger/` | `createLogger()` (`module.ts`, JSON lines on stderr), `serializeError()`, `toLine()` (`asserts.ts`), `LOG_LEVEL_RANK` |
| `loader/` | `loadAgent()`, `loadAgents()`, `listAgentFolders()`, `hashAgentFolder()` (`module.ts`), `readFreshModule()`, `createModuleJiti()`, `readModule()`, `createPackageAliases()`, `relativize()` (`asserts.ts`, internal), `AGENT_FILE` (`agent.ts`), `SCRIPT_EXTENSIONS`, the name rule (`constants.ts`, internal), `LoadedAgent`, `AgentLoadIssue`, `LoadAgentOptions`, `LoadAgentsResult` (`types.ts`); the only `locter`/`jiti` importer |
| `models/` | `createModelRegistry()`, `resolveModels()` (the registry plus the `ModelCheck` for later agents), `installDefaultProvider()` (`module.ts`), `isPackageNotFound()`, `defaultImporter()` (`asserts.ts`), `BUILTIN_PROVIDERS`, `MODEL_SEPARATOR` (`constants.ts`) |
| `core/` | The re-export of `@chamvi/core` and named `@chamvi/http` symbols (the documented exception, see conventions) |
| `modules/` | The built-ins, one folder each: `config/`, `store/` (`purge.ts` the purge timer, `maskPassword()`, `destroyQuietly()`, `isPurgingStore()` in `asserts.ts`), `static-tokens/` (the dev `*` token), `engine/`, `agents/` (`AgentsModule`, `agentsModule()` in `module.ts`; `createAgentsWatcher()` in `watcher.ts`, internal; `AGENTS_WATCHER_HOOK_NAME` and the messages in `constants.ts`), `scheduler/` (contributes `cronChannel()`; without `CHAMVI_SCHEDULER` in start mode a `cron` channel that validates but never fires), `http/` (contributes the `http`, `mcp` and `webhook` channels, mounts every contributed channel with an `in`; `resolveAuthenticators()` in `asserts.ts`), `console-channel/` (`consoleChannelModule()`, `chamvi:console`) |
| `authup/` | The `/authup` entry: `authupModule()` (`module.ts`), `oidcModule()` (`oidc.ts`), `*_MODULE_NAME` and the options types (they stay here: moving them to `@chamvi/http` would make http depend on app, a cycle) |
| `testing/` | The `/testing` entry: `buildModuleHarness()`, `createModuleHarness()` (`module.ts`, the real module lifecycle over the given modules: `reportingModule()`, `runStartSteps()`), `ModuleHarness`, `ModuleHarnessOptions`, `ModuleHarnessReport` (`types.ts`) |

## CLI Module Map (`packages/cli/src`)

| Path | Purpose |
|------|---------|
| `cli.ts` | The bin: `await runCli(process.argv.slice(2), processContext(fileURLToPath(import.meta.url)))` |
| `run/` | `runCli()` (`module.ts`: `--help`/`--version`, citty `runCommand`, errors to stderr with `exitCodeOf`), `processContext()`, `exitCodeOf()`, `createUsageError()`, `assertKnownArgs()`, `messageOf()`, `isRecord()` (`asserts.ts`), `EXIT_CODE`, `CLI_USAGE_ERROR_CODE` (public), `CITTY_ERROR_NAME`, `USAGE_ERROR_CODES`, `APP_STOPPED_ERROR_CODE` (`constants.ts`), `CliContext` (`types.ts`) |
| `commands/` | `createMainCommand()` (`module.ts`), one file per command (`dev.ts`, `build.ts`, `start.ts`, `run-job.ts`, `migrate.ts`), `readVersion()`, `loadDotEnv()` (`asserts.ts`, `node:util` `parseEnv`), `FORCE_EXIT_MS`, `DEV_FORCE_EXIT_MS`, `DEV_LINK_VARIABLE`, `BUILD_OUT_DIR`, `BUILD_OUTPUT_PATTERN`, `TSDOWN_PACKAGE`, ... (`constants.ts`) |
| `entry/` | `resolveEntry()` (`--entry`, `package.json` `chamvi.entry` for source commands only, `SOURCE_ENTRY`/`BUILT_ENTRY`), `loadApp()` (`isApp` check), `loadEntryApp()` (the default app without an entry) (`module.ts`), `DEFAULT_APP_NOTICE` (`constants.ts`), `EntryKind`, `ResolveEntryInput` (`types.ts`); not re-exported from the main entry |
| `signals/` | `installSignalHandlers()` (`module.ts`: first signal stops, a second one at least `SIGNAL_REPEAT_MS` (`constants.ts`, 1 s) later exits 1, the force-exit timer on the `IClock`, kept alive), `ISignalTarget` (public), `ProcessEvent`, `StopSignal`, `SignalHandlersInput`, `SignalHandlers` (`types.ts`) |

## Store-TypeORM Module Map (`packages/store-typeorm/src`)

| Path | Purpose |
|------|---------|
| `entities/` | One TypeORM entity per table, the repositories the store queries through; `TableName` and the jsonb transformers (`JSON_VALUE_TRANSFORMER`, `OPTIONAL_JSON_TRANSFORMER`) in `constants.ts`, `toJsonParameter()` (jsonb sanitizing) in `asserts.ts` |
| `migrations/` | `1792195200000-init.ts` (`Init1792195200000`), `1792368000000-artifacts.ts` (table `chamvi_artifacts`), generated from the entities; `1792454400000-idempotency-scope.ts` (`scope` varchar(1024), hand-written), `1792540800000-kv-key-collation.ts` (`chamvi_kv.key` `COLLATE "C"`, hand-written), `1792627200000-agent-revisions.ts` (`AgentRevisions1792627200000`, table `chamvi_agent_revisions`) |
| `schema/` | `migrateStore()` (`module.ts`), `STORE_ENTITIES`, `STORE_MIGRATIONS`, `MIGRATION_LOCK_NAME` |
| `store/` | `TypeormStore` (`module.ts`), entity to domain mapping, value builders and `RETURNING` row hydration (`asserts.ts`), `TypeormStoreOptions`, `PurgeResult` |

## UI Module Map (`packages/ui`)

| Path | Purpose |
|------|---------|
| `src/config/` | `UiConfig`, `UiAuthupConfig` (`types.ts`), `CONFIG_ELEMENT_ID` (public), `CONFIG_MARKER` (`constants.ts`); shared with the SPA as types and constants |
| `src/routes/` | `uiRoutes()` (`module.ts`), `resolveBuildPath()`, `loadBuild()`, `renderIndex()`, `buildCsp()`, `defaultRoot()`, `isFileLike()` (`asserts.ts`, internal), `DEFAULT_UI_BASE_PATH`, `ASSET_CACHE_CONTROL`, `DOCUMENT_CACHE_CONTROL` (public), `BUILD_RETRY_MS`, `MEDIA_TYPES`, `SECURITY_HEADERS`, `UI_BASE_PATH_PATTERN` (`constants.ts`), `UiRoutesOptions`, `BuildFile` (`types.ts`) |
| `src/module/` | The `/module` entry (the only folder importing `@chamvi/app`): `uiModule()`, `UiModule` (`module.ts`), `readAuth()` (`asserts.ts`), `UI_MODULE_NAME` (`constants.ts`), `UiModuleOptions` (`types.ts`) |
| `app/` | The SPA: `main.ts` (install order: icons, authup when configured, vuecs, component plugins, router), `App.vue`, `style.css` (Crimson tokens and classes of the approved mockup version 3, light and dark), `index.html` (with `CONFIG_MARKER`), `shims.d.ts`, `tsconfig.json` (vue-tsc, also checks `test/unit/app`) |
| `app/config/` | `readConfig()`, `DEV_CONFIG` |
| `app/router/` | `createUiRouter()`, `RouteName` |
| `app/context/` | `AppContext` (config, client, session, storage), `APP_CONTEXT`, `useAppContext()` |
| `app/api/` | `createApiClient()`, `ApiError` (`error.ts`), query and error helpers (`toApiError()` for a response, `asApiError()` for any thrown value, `retryDelayOf()` for a 429/503, `asserts.ts`), `RATE_LIMIT_BACKOFF_MS` (`constants.ts`), wire types (`Wire<T>`, `RunWire`, `IApiClient`, ...) |
| `app/sse/` | `openRunStream()`, `parseEventStream()`, `sleep()`, `RECONNECT_DELAYS_MS` |
| `app/auth/` | `createSession()`, `createAuthGuard()` (`guard.ts`), `createAuthupAdapter()` (`authup.ts`, lazily imported), `hasPermission()`, `safeReturnPath()`, `clearStorage()`, `createSessionCookies()` (`asserts.ts`), storage keys |
| `app/polling/` | `createPoller()`, `documentVisibility()` (`asserts.ts`), `IPageVisibility` |
| `app/runs/` | `useRunList()`, `useRunCounts()`, `useRunActivity()`, `useRunDetail()` (`composables.ts`), `mergeRunEvent()`, `canCancel()`, formatters (`asserts.ts`), route-query mapping (`query.ts`), constants |
| `app/approvals/` | `useApprovals()`, `useLinkedApproval()` (`composables.ts`), `pendingApprovals()`, `notifiedLine()`, `readApprovalLink()`, `approvalLinkQuery()`, `linkedApprovalState()`, `linkNotice()` (`asserts.ts`), `INBOX`, `INBOX_POLL_MS`, `INBOX_PAGE_SIZE` (`constants.ts`) |
| `app/agents/` | `useAgents()`, `useAgentRollups()` (overview), `useAgentDetail()` (agent page, `start()`) (`composables.ts`); `channelChips()`, `summarizeActivity()`, `buildRollups()`, `activityLabel()`, `createStartKeys()`, `newIdempotencyKey()`, `failedSummary()`, `tokenShares()`, `nextFireOf()`, `lastRunOf()`, `oldestWaiting()`, `hasHttpSubscription()`, `matchesName()`, `parsePayload()`, `formatBudgetTime()` (`asserts.ts`); `ACTIVITY_WINDOW_MS`, `ACTIVITY_LIMIT`, `ACTIVE_LIMIT`, `AGENTS_POLL_MS`, `RECENT_RUNS`, `AGENT_WAITING_LIMIT` (`constants.ts`); `ChannelChip`, `Activity`, `AgentRollup` (`types.ts`) |
| `app/state/`, `app/schedules/` | `useAgentState()`, `useSchedules()` and their helpers (`describeCron()` in `schedules/helpers.ts`) |
| `app/components/` | One folder per component: `app-shell`, `brand-logo`, `nav-icon` (`IconName`, the mockup's glyphs), `page-head`, `empty-state`, `status-chip`, `channel-chip`, `json-block`, `step-item`, `usage-meter`, `approval-callout`, `expiry-countdown`, `runs-table`, `schedule-card`, `activity-strip`, `agent-card`, `agent-runs`, `agent-state` (`AgentStatePanel`), `start-run` (`StartRunModal`), `tab-list` (`TabList`, the ARIA tabs pattern: roving tabindex, arrow keys, `tabForKey()`) |
| `app/views/` | `LoginView`, `LoginCallbackView`, `AgentsView`, `AgentView`, `RunsView`, `RunView`, `ApprovalsView`, `SchedulesView` |
| `vite.config.ts` | Root `app`, out `dist/app`, `base: './'` for the build, the dev proxy to port 3000, the `virtual:chamvi-icons` plugin |
| `test/e2e/` | `smoke.spec.ts` (Playwright), `demo/` (`server.ts`, `model.ts`, `constants.ts`) |
