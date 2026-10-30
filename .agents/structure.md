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
│   ├── github/                      # @chamvi/github (same layout; aliases core, http, test-kit, itself and its /module, app, app/testing, channel-cron, store-db to src)
│   │   └── test/fixtures/deliveries/ # Recorded GitHub webhook bodies (issues.opened, a bot's issue_comment)
│   ├── channel-openclaw/            # @chamvi/channel-openclaw (aliases core, test-kit, itself and its /module, plus app, app/testing, http, channel-cron, store-db; fake gateway in test/utils/openclaw.ts)
│   ├── sandbox/                     # @chamvi/sandbox (same layout; aliases core, itself and its /module, sandbox-local, app, app/testing, http, channel-cron, store-db; private test/utils/clock.ts)
│   │   └── src/instructions/        # Bounded workspace-exec collector, include/protocol helpers, source/provenance/diagnostic types and limits
│   ├── sandbox-local/               # @chamvi/sandbox-local (aliases core, sandbox, test-kit and itself)
│   ├── sandbox-docker/              # @chamvi/sandbox-docker (same aliases as local, plus coding for test/unit/coding.spec.ts; fixture images in test/fixtures/{no-git,no-cache,no-init,entrypoint})
│   │   └── test/global-setup.ts     # dockerode ping() gate, builds images/sandbox-dev as chamvi/sandbox-dev:test, removes the test cache volume
│   ├── sandbox-k8s/                 # @chamvi/sandbox-k8s (same aliases; tests drive a fake IPodClient, test/utils/client.ts)
│   ├── coding/                      # @chamvi/coding (aliases core, sandbox, sandbox-local, test-kit and itself)
│   ├── skills/                      # @chamvi/skills (optional skill runtime, catalogs, bundles and pinned Git sources)
│   ├── tool-web/                    # @chamvi/tool-web (aliases core, test-kit and itself; fake transport, fetch and lookup in test/utils/web.ts)
│   ├── ui/                          # @chamvi/ui (aliases core, http, test-kit, itself and its /module, plus app, app/testing, channel-cron, store-db to src)
│   │   ├── src/                     # Node entries (tsdown -> dist/index.mjs: uiRoutes(); dist/module.mjs: uiModule())
│   │   ├── app/                     # The SPA (Vite root -> dist/app), own tsconfig for vue-tsc
│   │   └── test/{unit,e2e}/         # Vitest (routes, app modules), Playwright smoke spec + demo server
│   ├── app/                         # @chamvi/app (aliases every workspace package it imports, itself and its subpaths to src)
│   │   ├── src/                     # main entry src/index.ts, subpath entries src/{authup,testing}/index.ts
│   │   └── test/                    # global-setup.ts (postgres:18-alpine via testcontainers), utils/harness.ts (aliases @chamvi/app/testing's harness)
│   ├── cli/                         # @chamvi/cli (bin chamvi -> dist/cli.mjs; aliases app and its imports to src)
│   │   ├── src/cli.ts               # the bin (shebang, then the header)
│   │   └── test/fixtures/           # apps the commands and the spawned bin run: app (README), failing, hang, slow, keyless, broken
│   ├── store-db/               # @chamvi/store-db (same layout)
│   │   ├── src/{entities,migrations,schema,store}/
│   │   └── test/global-setup.ts     # Starts postgres:18-alpine via testcontainers for the suite
│   └── docs/                        # @chamvi/docs (private, not released): VitePress site (npm run docs:dev / docs:build)
│       ├── src/.vitepress/          # config.mts, theme/ (Tailwind v4 tokens, Layout.vue), components/{home,layout}/
│       ├── src/public/              # logo.svg (favicon), fixed light/dark logo and run-lifecycle copies
│       └── src/snippets/            # Code samples included via <<<, type-checked by the docs typecheck
├── images/
│   ├── sandbox-dev/                 # Dockerfile + README of ghcr.io/chamvi/sandbox-dev (Debian, git, build tools, ripgrep, jq, mise; root)
│   └── sandbox-node/                # deprecated ghcr.io/chamvi/sandbox-node (Node 24, uid 1000), built for one more release
├── .github/
│   ├── assets/                      # logo.svg (+ test-kit and organisation variants), run-lifecycle.svg
│   ├── actions/{install,build}/     # Composite actions
│   ├── workflows/{ci,release,docs,images}.yml # CI (Node 24.3.0 and latest 24, plus the Chromium e2e job), release-please + npm publish, docs to GitHub Pages, sandbox image (craneship, amd64 + arm64)
│   ├── ISSUE_TEMPLATE/              # Bug report and feature request templates
│   ├── FUNDING.yml                  # GitHub Sponsors
│   └── dependabot.yml               # Daily npm + github-actions updates, docker for images/sandbox-dev and images/sandbox-node
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
| `@chamvi/core` | Exists (0.1.0) | defineAgent, run engine (streaming, structured output, models: `ModelRef`, `EngineOptions.model`/`models` (`IModelResolver`), `checkAgentModel`, `resolveModel(ctx, ref?)`, the live agent registry `putAgent`/`removeAgent` with revision markers), `provide`/`inject` context for tools (`defineContextKey`, `inject`, `tryInject`), checkpoints, the channel contract (`IChannel`, subscriptions, the envelope with `channel`/`address`, `EngineOptions.channels` started and stopped by the engine, `ToolContext.channels` (`findOne`, `findOneOrFail`, `find`) with effect-recorded `emit()`, `consoleChannel()`), durable `approve()` (suspend, pending tool calls, replay) and agent `hooks`, run artifacts, state API, budgets, the `IStore` aggregate, in-memory store |
| `@chamvi/test-kit` | Exists (0.1.0) | `ControllableClock`, `describeRepositoryContract()`, `describeWorkspaceContract()`, `createGitFixture()`, `createFakeGithub()` (in-process GitHub for `createGithubApp({ fetch })`); depends on core only (the workspace contract types `IWorkspace` structurally as `ContractWorkspace`: a sandbox edge would close a release-please cycle through app); core and sandbox never depend on it |
| `@chamvi/http` | Exists (0.1.0) | `createHttpApp()` (routup v6): REST control API, SSE run stream, the `httpChannel()`/`mcpChannel()`/`webhookChannel()` channels with `http.on()`/`webhook.on()`, the `/channels/<name>` mount (`channels` option), MCP endpoint, authenticators (static tokens, authup, oidc), health, metrics, `createShutdown()`; peer on core |
| `@chamvi/channel-cron` | Exists (0.1.0) | `cronChannel()` (start/stop around one locked hubwire component per cron subscription, live on `agents.changed`), `cron.on()`, `runJob()`; `createScheduler()` internal; depends on `hubwire` and `cron-parser`, peer on core |
| `@chamvi/store-db` | Exists (0.1.0) | `createDatabaseStore()`, entities, initial migration, `migrateStore`, `purgeExpired` |
| `@chamvi/sandbox` | Exists (0.1.0) | `ISandboxProvider`/`IWorkspace`/`IExecTransport` contracts, path, repo, ref, limit and env rules, output collector, `createRemoteWorkspace()`, `prepareWorkspace()`, the run-scoped `createWorkspaceManager()` with `create_workspace`/`dispose_workspace`, root and explicit path-scoped instruction delivery (`read_repository_instructions`), `readRepositoryInstructions()` (bounded current-worktree `AGENTS.md`/`CLAUDE.md` and include collector, scopes/hashes/parents/diagnostics), the context pair `provideSandboxContext`/`injectSandboxContext`; `/module`: `sandboxModule()` (optional peer on `@chamvi/app`, the providers optional peers loaded by variable specifier); depends on `smob`, peer on core and `ai` |
| `@chamvi/sandbox-local` | Exists (0.1.0) | `createLocalSandbox()`: temp directory + spawn, no isolation; depends on `smob`, peer on core and sandbox |
| `@chamvi/sandbox-docker` | Exists (0.1.0) | `createDockerSandbox()`: one container per workspace (root inside, a hardened mode, a per-workspace `/cache`, a named shared volume opt-in); depends on `dockerode` + `@types/dockerode`, `smob`, peer on core and sandbox |
| `@chamvi/sandbox-k8s` | Exists (0.1.0) | `createKubernetesSandbox()`, `createPodClient()`: one pod per workspace (root inside, a hardened mode, an optional cache claim); depends on `@kubernetes/client-node`, `smob`, peer on core and sandbox |
| `@chamvi/coding` | Exists (0.1.0) | `codingTools()` (read_file, write_file, edit_file, multi_edit, grep, glob, list_files, bash with kept cwd and exports and output logs, background jobs with bash_output and bash_kill, git_diff), optional path-scoped instructions on ordinary UTF-8 workspace `read_file` results (its own default-on `repositoryInstructions` flag, independent of the manager), the `ICodingBackend` contract; depends on `smob`, peer on core, sandbox and `ai` |
| `@chamvi/skills` | Exists (0.3.1) | Skill domain types, catalogs, custom adapters and per-engine runtime; `gitSkills()`/`loadSkillBundle()` carry the runtime automatically; bundle hashing/loading and `prepareSkills()` for setup/build; core peer, no app edge or module registration, Node >=24.3.0 plus Git for source preparation |
| `@chamvi/tool-web` | Exists (0.2.1) | `webTools()`: `web_fetch` (a public http(s) page as markdown, text or raw through a hapic client, proxy from the environment; every URL and redirect target resolved and refused on a non-public address, `allowUrl` decides first; byte, character and time caps, offset paging); depends on `hapic`, `mdream`, `smob`, peer on core and `ai` |
| `@chamvi/ui` | Exists (0.1.0) | `uiRoutes()`: serves the prebuilt Vue 3 + vuecs dashboard (runs, run detail, approvals, agent state, schedules) as one extra route of `createHttpApp({ routes })`; `/module`: `uiModule()` (optional peer on `@chamvi/app`); peer on core and http (types only), every SPA library a bundled devDependency |
| `@chamvi/app` | Exists (0.1.0) | `createApp()` (`IApp`: `start`, `check`, `stop`, `runJob`, `migrate`), built-in orkos modules (config, store, static tokens, engine (every `AppToken.CHANNELS` contribution), agents (the `CHAMVI_AGENTS_DIR` folder loader and watcher), scheduler (the cron channel), http (the http, mcp and webhook channels, the `/channels` mount), plus the optional `consoleChannelModule()`) over an eldin container, `AppToken`s, env readers, `readConfig()`, the JSON line logger, the model settings and resolver (`CHAMVI_MODEL`, `CHAMVI_PROVIDER_*`, `chamvi.json`), `IApp.check()`; the module contract (tokens, `ModuleName`, env readers, `approvalUrlOf`, `AppContext`, `ILifecycleHook`, the orkos `IModule` and eldin `IContainer` types); subpaths `/authup` (`authupModule`, `oidcModule`) and `/testing` (`buildModuleHarness()`, `createModuleHarness()`), the other optional modules live in their feature packages on `/module`; re-exports core and part of http; depends on core, http, channel-cron, store-db, `orkos`, `eldin`, `envix`, `routup`, `smob`, `locter`, `jiti`, `validup`, `@ebec/core`, peer on `ai`, `typeorm`, `pg` (optional: the AI SDK provider packages and the two `@authup/*` packages; no `@chamvi/*` feature package in any dependency field) |
| `@chamvi/cli` | Exists (0.1.0) | The `chamvi` bin (citty): `dev`, `build`, `start` (`--check`), `run-job`, `migrate`, entry loading, signals, exit codes `0/1/2`; `runCli()`; depends on `citty`, peer on app (optional `tsdown`) |
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
| `trigger/` | `TriggerEnvelope` (`channel`, `address`, `parent`), `TriggerParent`, `Invoker` (`types.ts`), `assertTriggerKey()` (`key.ts`), `TRIGGER_KEY_MAX_LENGTH` (`constants.ts`), `normalizeEnvelope()` (public: the legacy `source`/`thread` read-back for repositories), `toInvoker()`, `idempotencyScope()` (`asserts.ts`, internal) |
| `channel/` | `IChannel`, `ChannelRequest`, `ChannelContext`, `ChannelDispatchEnvelope`, `DispatchResult`, `ChannelMessage`, `ChannelSendOptions`, `ChannelSubscription`, `EmitMessage`, `ChannelHandle`, `ToolChannels`, `ConsoleChannelOptions` (`types.ts`); `consoleChannel()` (`console.ts`); `agentChannel()` (`agent.ts`); `AGENT_CHANNEL_NAME` (`constants.ts`); `assertChannelName()`, `createToolChannels()` (`ToolContext.channels`), `createChannelHandle()` (the emit effect and `approve()` with a channel) (`asserts.ts`, internal); `ChannelNotFoundError` lives in `errors/channel-not-found.ts` |
| `artifact/` | `Artifact`, `ArtifactInput`, `ArtifactFilePart`, `IRunArtifacts` (`types.ts`); `ARTIFACT_URI_PREFIX` (`constants.ts`, internal); `artifactFilePart()` (public), `createRunArtifacts()`, `storeArtifact()`, `attachmentIds()` (`module.ts`, the last three internal); `isArtifactMediaType()` (`media-type.ts`, public); `assertArtifactInput()`, `toFilePart()`, `hydrateMessages()` (`asserts.ts`) |
| `run/` | `RunStatus` enum (`constants.ts`); `Run`, `RunStatusLiteral`, `Step`, `Checkpoint`, `WaitPoint`, `Budget`, `Usage` |
| `repository/types.ts` | `IStore` aggregate and its capability interfaces (see architecture) |
| `repository/memory/` | `createMemoryStore()` and separate `Memory*Repository` capability classes |
| `run/helpers.ts` | Internal shared abort-aware wait used by execution and memory-bound channel sends, not a public export. |
| `conversation/` | Optional conversation contract/types and limits, engine-local helpers, canonical store policy (`persistence/`, exposed only as `@chamvi/core/conversation/persistence`), `MemoryConversationRepository`, execution bindings (`context.ts`) and capability (`module.ts`); trusted intake is bound by `Engine.channelContext()`, explicit `memoryTools()` and `hasConversation()` (`tools.ts`). `IStore.conversations` carries the optional storage capability. |
| `engine/` | `Engine` (`module.ts`: channel start/stop and trusted intake, `pause()`, `answer()`, `deliverApproval()`), `IEngine` (`types.ts`), `skills/` (internal `EngineSkills` implementing `IEngineSkills`: input capture, runtime validation, preparation and contribution lookup; no lifecycle coordination), `RunEvent`, `RunDelta`, `DispatchEnvelope`, `ApprovalAnswer`, `EngineStartOptions` (`types.ts`), `budget.ts` (stop conditions), `queue/` (scheduler, the `prepareStart` guard), `execute/` (one streamed execution; `pendingToolCalls()`, `withoutResults()`, `withToolResults()`, `executePendingCall()` in `asserts.ts` run the calls an approval suspended), `registry/` (`withAgentLock()`, `agentCancelReason()` in `helpers.ts`; `cancelAgentRuns()`, `syncRevision()`, `claimRevision()`, `dropRevision()` in `module.ts`; `RegistryContext`, `CancelReason`; all internal), `AGENT_LOCK_TTL_MS`, `REVISION_PREFIX_LENGTH` (`constants.ts`, internal), `AgentChange`, `AgentRunsCancelled`, `EngineEvent` (`types.ts`) |
| `effect/` | `defineEffectTool()`, `effectMarker()` (`define.ts`), `wrapToolsForRun(tools, ctx, store, { allow?, hooks? })` (`wrap.ts`: the tool-call frame, hooks, effect lookup, `SuspendSignal` catch), `EFFECT`, `WrapToolsOptions`; `runToolCall()`, `currentToolCall()` (`frame.ts`, internal: the `AsyncLocalStorage` tool-call frame), `ToolCallFrame` (`types.ts`, internal) |
| `tool/` | `ToolContext` (`types.ts`), `toolContextSchema` (`constants.ts`), `defineTool()` (`define.ts`), `hasToolContext()` (`asserts.ts`, internal) |
| `handoff/` | `startHandoff()` (`module.ts`), `handoff` (`handoff.on()`, `subscription.ts`), `HandoffSubscriptionOptions`, `HandoffSubscriber`, `HandoffInput`, `HandoffResult` (public) and the internal `HandoffHost` (`types.ts`), `HANDOFF_SUBSCRIPTION_ID`, `DEFAULT_MAX_HANDOFFS_PER_RUN`, `MAX_HANDOFF_DEPTH` (public) and `HANDOFF_CONTEXT` (internal, key `handoff`) (`constants.ts`), `findHandoffSubscription()`, `validatePayload()`, `claimKey()`, `assertHandoffKey()` (`helpers.ts`, internal) |
| `approval/` | `approve()` and the internal `requestApproval()`, `SuspendSignal` (`request.ts`), `ApprovalRequestInput`, `ApprovalDecision`, `ApprovalOption` (`types.ts`), `DEFAULT_APPROVAL_TIMEOUT_MS`, `APPROVAL_TIMEOUT_MAX_MS`, `APPROVAL_OPTIONS_MAX`, `APPROVAL_OPTION_ID_PATTERN`, `APPROVAL_OPTION_LABEL_MAX_LENGTH`, `APPROVAL_OPTION_DETAIL_MAX_LENGTH`, `APPROVAL_OPTIONS_DETAIL_MAX_LENGTH` (public), `SUSPENDED_RESULT` (internal) (`constants.ts`), `approvalDecisionKey()`, `toApprovalDecision()`, `toApprovalOptions()`, `assertSelectionShape()`, `toSelection()` (`helpers.ts`, internal) |
| `permission/` | `matchesPermission()`, `hasPermission()`, `toolPermission()` (`match.ts`), `requireToolPermission()` (`policy.ts`), `RequireToolPermissionOptions` (`types.ts`), `PERMISSION_ALL` (`constants.ts`, internal) |
| `message/` | Native SDK message/content aliases (`types.ts`), exported through the core barrel; internal instruction validation, normalization, leading-system split and transcript trust guards (`helpers.ts`). |
| `skill/` | Generic `SkillInput`, `ISkillRuntimeProvider`, `ISkillRuntime`, `ISkillPreparation`, `PreparedAgentSkills` and `SkillContribution` (`types.ts`); protocol compatibility and opaque input snapshots (`helpers.ts`). Engine coordinates preparation, cancellation, readiness and ordinary contributed tools. No skill domain types, catalogs, hashes, content, source caches, filesystem or SDK dependencies. |
| `state/` | `createAgentState()` (`module.ts`, validation via `@validup/standard-schema`), generated tools (`tools.ts`) |
| `model/` | `ModelRef`, `IModelResolver`, `ModelCheckOptions` (`types.ts`, public region) and the internal `ModelContext`; `checkAgentModel()`, `resolveModel()` (public) and `checkDefaultModel()` (`module.ts`); `toLanguageModel()` (`asserts.ts`, internal: the one resolution path of the engine and `resolveModel`); `MODEL_CONTEXT` (`constants.ts`, internal, key `model`) |
| `clock/` | `IClock`, `systemClock` |

`src/index.ts` re-exports each folder's `index.ts`. `@chamvi/test-kit` (`packages/test-kit/src`) holds `model/` (`mockModel`, `textModel`, `approvalModel`, `failingModel`, `MockPart`, `MockResponse`), `skill-runtime/` (`fakeSkillRuntime`), `clock/` (`ControllableClock`), `conversation-contract/` (`describeConversationRepositoryContract`), `repository-contract/` (`describeRepositoryContract`), `workspace-contract/` (`describeWorkspaceContract`, `WorkspaceContractFactory`), `git-fixture/` (`createGitFixture`, `GitFixture`) and `github-fake/` (`createFakeGithub` in `module.ts`, `FakeGithub`, `FakeGithubOptions`, `FakeRequest`, `FakeRoute*`, `JwtClaims` in `types.ts`, the repository routes and `abortable()` in `asserts.ts`).

## Cron Channel Module Map (`packages/channel-cron/src`)

| Path | Purpose |
|------|---------|
| `channel/` | `cronChannel()` (`module.ts`: `start` builds the per-agent components and follows `agents.changed`, `stop` stops and awaits them, `on()` bound to its name), `CronChannel`, `CronChannelOptions`, `CronChannelErrorContext` (`types.ts`), `CRON_CHANNEL_NAME` (`constants.ts`), `markCronChannel()`, `isCronChannel()`, `assertCronChannelOptions()` (`asserts.ts`, internal) |
| `subscription/` | `cron` (`cron.on()`, the only export) and `createCronSubscription()` (`module.ts`, cron-parser and timezone validation), `OverlapPolicy`, `CronSubscriptionOptions`, `CronSubscriber` (`types.ts`), `OVERLAP_POLICIES` (`constants.ts`) |
| `lock/` | `createRepositoryScheduleLock()`: hubwire `IScheduleLock` over core's `ILockRepository` |
| `tick/` | `fireCronSubscription()` (overlap check, envelope, dispatch), `readCronOptions()`; `isOverlapping()` in `asserts.ts` |
| `scheduler/` | `createScheduler()` (internal, the channel's engine), `assertSchedulable()` (public), `SCHEDULE_LOCK_TTL_MS`; `buildComponentOptions()`, `cronSubscriptionsOf()`, `buildAgentComponents()`, `toDefinitionError()` (`asserts.ts`, internal) |
| `run-job/` | `runJob()` (`start({ channels: false })`); `resolveCronSubscription()`, `isQueuedBehindApproval()` (`asserts.ts`), `SETTLING` (`constants.ts`), both internal |

## HTTP Module Map (`packages/http/src`)

Folders without an `index.ts` export nothing public; other modules import the file they need.

| Path | Purpose |
|------|---------|
| `app/` | `createHttpApp()` (`module.ts`), `HttpAppOptions` (incl. `channels`), the `HttpRoute*` types and the internal `HttpContext` (`types.ts`), defaults and `RESERVED_ROUTE_SEGMENTS` (incl. `channels`) (`constants.ts`), `buildContext()` (incl. `validateRoutes()`) and the JSON error handler (`asserts.ts`) |
| `auth/` | `Principal`, `Authenticator` (`types.ts`), `Permission` (`constants.ts`), `agentPermission()` (`module.ts`; permission matching is core's `hasPermission(principal.permissions, ...)`), `authenticate()`, `authorize()`, `readBearerToken()`, `toInvoker()` (`asserts.ts`, internal; display name from `name` or `preferred_username`, never `email`); `static-tokens/`, `authup/`, `oidc/` hold the built-in authenticators |
| `request/` | No barrel: `readJsonBody()`, `readRequestBody()` (public through `channels/`), `validateBody()`, `validatePayload()`, `decodeQuery()` (rapiq), `readIdempotencyHeader()`, `boundReceived()`, `boundIssues()` (`asserts.ts`); `KEY_MAX_LENGTH`, `RECEIVED_MAX_LENGTH` (`constants.ts`); validup validators `isString()`, `isBoolean()`, `isDefined()`, `isArrayOf()`, `isStringArray()`, `isMediaType()`, `isBase64()` (`validators.ts`) |
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
| `app/` | `createGithubApp()` (`module.ts`, incl. `repositoryToken()`, `botIdentity()`, `installationFor()` and `repositoryInstallation()` over one TTL cache and `installations()`), `GithubAppOptions`, `IGithubApp`, `GithubOctokit`, `GithubPermissions`, `GithubRepositoryToken`, `GithubBotIdentity`, `GithubInstallation`, `GithubMergeMethod`, `GithubWriteToolsOptions` (`types.ts`), `DEFAULT_GITHUB_API_URL`, `INSTALLATION_CACHE_TTL_MS` (`constants.ts`), `PaginatedOctokit`, `toInstallation()` and option normalizers (`helpers.ts`, internal) |
| `auth/` | No barrel: `createInstallationTokens()` (`module.ts`, token cache, `repository()` for scoped tokens), `withAppTimeout()` (`module.ts`), `createAppJwt()`, `normalizePrivateKey()` (`asserts.ts`), `JWT_*`, `TOKEN_REFRESH_MARGIN_MS`, `GITHUB_USER_AGENT` (`constants.ts`) |
| `channel/` | `githubChannel()` (`module.ts`), the comment sender `createCommentSender()` (`out.ts`: marker reconcile, then the post), `GithubChannelOptions`, `GithubApprovalRef`, `GithubChannel` (`types.ts`, public region) and the internal `CommentTarget`, `ResolvedGithubChannelOptions`; `GITHUB_CHANNEL_NAME`, `GITHUB_CHANNEL_TIMEOUT_MS`, `COMMENT_BODY_MAX_LENGTH` (public) and `DEFAULT_BODY_LIMIT`, `CHANNEL_NAME_PATTERN`, `LOGIN_PATTERN`, `RECONCILE_SKEW_MS`, `SAFE_KEY_PATTERN`, `BACKTICK_RUN_MAX_LENGTH` (internal) (`constants.ts`); `resolveOptions()`, `parseAddress()`, `markerKey()`, `cutText()`, `fenceFor()`, `renderOptions()`, `renderComment()` (`asserts.ts`) |
| `subscription/` | `github` (`github.on()`, `github.to()`), `createGithubSubscription()`, `githubAddress()` (`module.ts`), `GithubEvent`, `GithubPayload`, `GithubSubscriptionOptions`, `GithubTarget`, `GithubSubscriber` (`types.ts`), `GITHUB_EVENT_PATTERN`, `SELF_EVENTS_REFUSED` (`constants.ts`); `matchesGithubSubscription()`, `acceptsSelfSent()`, `assertSelfEvents()`, `defaultConcurrencyKey()`, `eventAddress()` (`helpers.ts`, internal) |
| `webhook/` | `receiveDelivery()` (`module.ts`, internal: the channel's `in`), `verifySignature()`, `readHeaders()`, `toGithubEvent()`, `isJsonMediaType()` (`asserts.ts`), `EVENT_HEADER_PATTERN`, `SIGNATURE_PATTERN` (`constants.ts`), `GithubWebhookResult` (`types.ts`, the only export) |
| `tools/` | `createReadTools()` (`read.ts`, incl. `github_list_releases` and `github_compare`), `createWriteTools()` (`write.ts`, incl. `github_create_issue`), `createRepositoryTools()` (`repositories.ts`: `github_list_repositories`, `github_list_issues`), `createPullRequestTools()`, `toPullRequest()` (`pulls.ts`: `github_list_pull_requests`, `github_get_pull_request_checks`, `github_get_push_target`), `readChecks()`, `summarizeChecks()` (`checks.ts`), `createPullRequestWriteTools()` (`merge.ts`: `github_create_pull_request`, `github_merge_pull_request`), `installationOf()`, `withOctokit(app, ctx, target, fn)`, `bindSignal()`, `untilAborted()`, `searchTarget()`, `inputEffectKey()`, `reconcileSince()`, `resolveMergeMethod()`, `requireRef()`, `parseRepo()`, `stepOf()`, `toolError()`, `versionOf()`, `compareVersions()`, `versionBound()`, `cut()` and the input schema builders (`helpers.ts`), limits (`RELEASES_MAX`, `RELEASE_BODY_MAX_CHARS`, `RELEASE_PAGES_MAX`, `COMPARE_COMMITS_MAX`, `COMPARE_FILES_MAX`, `COMMIT_MESSAGE_MAX_CHARS`, `REPOSITORIES_MAX`, `ISSUES_MAX`, `PULL_REQUESTS_MAX`, `CHECKS_MAX`, `REF_PATTERN`, `HEAD_PATTERN`, `SHA_PATTERN`, ...), `REPO_PATTERN`, `GITHUB_REQUEST_ERROR_CODE`, `DEFAULT_MERGE_METHOD`, `MERGE_METHODS`, `MERGE_STATES` (`constants.ts`; those five are exported), result shapes (`types.ts`) and the internal `RepoInput`/`NumberInput`/`RepoTarget` |
| `context/` | `provideGithubContext()`, `injectGithubContext()` (`module.ts`), `GITHUB_CONTEXT` (`constants.ts`, internal; key `github`) |
| `credentials/` | `githubAppCredentials()` (`module.ts`), `IGithubGitCredentials`, `GithubGitCredentialRequest`, `GithubGitCredential`, `GithubAppCredentialsOptions` (`types.ts`, structurally `@chamvi/sandbox`'s contract), `DEFAULT_GITHUB_GIT_HOST`, `GITHUB_TOKEN_USERNAME` (`constants.ts`) |
| `module/` | The `/module` entry (the only folder importing `@chamvi/app`): `githubModule()`, `GithubModule` (`module.ts`; contributes `githubChannel()` to `AppToken.CHANNELS` and `githubAppCredentials()` to `AppToken.GIT_CREDENTIALS`), `createGithubAppFromEnv()` (`asserts.ts`), `GITHUB_MODULE_NAME` (`constants.ts`), `GithubModuleOptions`, `GithubModuleChannelOptions` (`types.ts`) |

## OpenClaw Channel Module Map

`@chamvi/channel-openclaw` (`packages/channel-openclaw/src/channel/`): `openclawChannel()` (`module.ts`, out only); `OpenclawChannelOptions`, `OpenclawApprovalRef`, `OpenclawDelivery`, `OpenclawHookBody` (`types.ts`, public between `#region public` markers the docs include) and the internal `ResolvedOpenclawOptions`; `OPENCLAW_CHANNEL_NAME`, `DEFAULT_HOOKS_PATH`, `OPENCLAW_TIMEOUT_MS`, `OPENCLAW_REQUEST_ERROR_CODE`, `MESSAGE_BODY_MAX_LENGTH` (public) and `HOOK_NAME`, `IDEMPOTENCY_KEY_MAX_LENGTH`, `ERROR_TEXT_MAX_LENGTH`, `APPROVAL_HINT`, `CHOICE_HINT` (internal) (`constants.ts`); `resolveOptions()`, `hookUrl()`, `renderMessage()`, `transportKey()`, `cutText()`, `redact()`, `fetchErrorMessage()`, `requestError()`, `responseError()` (`asserts.ts`). `module/` (the `/module` entry, the only folder importing `@chamvi/app`): `openclawModule()`, `OpenclawModule` (`module.ts`, name `chamvi:channel:<name>`, contributes the channel to `AppToken.CHANNELS`), `readDelivery()` (`asserts.ts`), `ERROR_PREFIX`, `VARIABLES` (`constants.ts`), `OpenclawModuleOptions` (`types.ts`). No context pair: tools use `ctx.channels.findOne(name)`.

## Sandbox Module Map (`packages/sandbox/src`)

| Path | Purpose |
|------|---------|
| `workspace/` | `IWorkspace`, `WorkspaceInfo`, `ExecOptions`, `ExecResult` (`types.ts`); `assertArgv()`, `decodeUtf8File()` (`module.ts`); `WORKSPACE_ROOT`, `WORKSPACE_HOME`, `OUTPUT_MAX_BYTES`, `FILE_MAX_BYTES` (16 MiB), `EXEC_TIMEOUT_MS`, `EXEC_TIMEOUT_MAX_MS`, `SANDBOX_ENV` (`constants.ts`) |
| `provider/` | `ISandboxProvider` (`create`, `find`, `collectGarbage`), `WorkspaceCreateOptions`, `WorkspaceFindOptions`, `GarbageCollectOptions`, `SandboxLimits` (`types.ts`); `DEFAULT_LIMITS`, `DEFAULT_SANDBOX_IMAGE`, `TMP_SIZE`, `SLEEP_UNTIL_SCRIPT`, `SANDBOX_LABELS`, `SANDBOX_LABEL_SELECTORS`, `RUN_LABEL`, `WORKSPACE_LABEL`, `DEPLOYMENT_LABEL`, `DEFAULT_DEPLOYMENT`, `REPO_KEY_LABEL`, `EXPIRES_AT_KEY`, `CREATED_AT_KEY`, `REPO_URL_KEY`, `REF_KEY`, `IMAGE_KEY` (`constants.ts`); the helpers every provider shares: `assertCreateInput()`, `abortedCreate()`, `assertImageOption()`, `assertTmpSizeOption()`, `assertClockOption()`, `buildWorkspaceInfo()`, `isExpiredAt()`, `lifetimeSeconds()`, `collectionError()`, `assertDeployment()`, `repoKey()`, `workspaceLabels()`, `workspaceMetadata()`, `readWorkspaceInfo()`, `createSettledCheck()` (`module.ts`), `isName()`, `readEpoch()`, `DEPLOYMENT_PATTERN`, `REPO_KEY_LENGTH` (`helpers.ts`, internal) |
| `clock/` | `delay()` (a wait on the `IClock` that rejects with the caller's abort error) |
| `image/` | `assertImage()`, `probeImage()`, `cacheEnv()`, `isRootUser()` (`module.ts`); `CACHE_DIR`, `CACHE_ENV`, `ROOT_CAPABILITIES`, `IMAGE_REQUIREMENTS`, `IMAGE_PROBE_TIMEOUT_MS` (public), `IMAGE_PATTERN`, `CACHE_FOLDERS`, `IMAGE_PROBE_SCRIPT`, `IMAGE_PROBE_MISSING_EXIT` (`constants.ts`, internal) |
| `limits/` | `resolveLimits()`, `parseCpu()`, `parseMemory()`, `assertSandboxEnv()` (`module.ts`); patterns and units (`constants.ts`, internal) |
| `output/` | `createOutputCollector()`, `createSinkStream()` (a `Writable` into an `IOutputSink`) (`module.ts`), `IOutputCollector` (`types.ts`), `completeLength()` (UTF-8 cut, `asserts.ts`) |
| `path/` | `resolveWorkspacePath()`, `absoluteWorkspacePath()` |
| `repo/` | `normalizeRepo()`, `assertGitRef()`, `prepareWorkspace()` (full history, the default branch; records `chamvi.defaultBranch`, then, last, the checkout record `chamvi.checkout`), `readCheckout()` (`module.ts`), `isGitRef()`, `parseDefaultBranch()` and URL checks (`helpers.ts`, internal), `CHECKOUT_KEY`, `NO_REPO_CHECKOUT`, `CHECKOUT_DEFAULT_BRANCH_KEY`, `CHECKOUT_READ_TIMEOUT_MS` (`constants.ts`, internal), `NormalizeRepoOptions`, `CheckoutOptions` (`types.ts`) |
| `credentials/` | `staticGitCredentials()` (`module.ts`), `credentialRequest()`, `resolveGitCredential()`, `createRedactor()`, `isCredentialValue()`, `trimRepoPath()` (`helpers.ts`, internal), `REDACTED`, `CREDENTIAL_REFRESH_MS`, `CREDENTIAL_RETRY_MS`, `CREDENTIALS_FILE`, `REDACT_MIN_LENGTH`, `REDACT_GRACE_MS` (`constants.ts`), `IGitCredentials`, `GitCredential`, `GitCredentialRequest`, `GitAccess`, `StaticGitCredential`, `Redactor` (`types.ts`) |
| `git/` | No barrel: `gitArgv()`, `runGit()` (`module.ts`), `urlOrigin()`, `urlRepoPath()`, `credentialKey()`, `credentialsFileContent()` (`helpers.ts`), `GIT_AUTH_SCRIPT` (one-shot helper over stdin), `CREDENTIAL_HELPER_SCRIPT`, `INSTALL_CREDENTIALS_SCRIPT`, `CLEAR_CREDENTIALS_SCRIPT` (`constants.ts`) |
| `remote/` | `createRemoteWorkspace()` over an `IExecTransport` (`module.ts`), `wrapTimeout()`, `wrapExec()`, `exitMarker()`, `createExitMarkerFilter()`, `isTimeoutExit()`, output helpers (`asserts.ts`, internal), `TIMEOUT_KILL_AFTER_SECONDS`, `EXEC_GRACE_MS`, `ALIVE_PROBE_TIMEOUT_MS` (public), `EXIT_DRAIN_MS`, `EXIT_MARKER_CWD`, `EXEC_SCRIPT` and `WRITE_FILE_SCRIPT` (`constants.ts`, internal) |
| `manager/` | `createWorkspaceManager()` (`module.ts`: adoption through `provider.find` on a miss, one lookup per run at a time), `createWorkspaceTools()` (`tools.ts`, internal), `createGitTools()` (`git-tools.ts`, internal: `git_fetch`, `git_pull`, `git_push`), `createCredentialSupport()` (`credentials.ts`, internal: lookups, the redacting view with `readFileRaw`, the workspace credential file), option checks (`credentialSources()`, `authorEnv()`, `offersImage()`) and tool input helpers (`helpers.ts`), `MAX_WORKSPACES_PER_RUN`, `GC_INTERVAL_MS`, `GC_INTERVAL_MAX_MS`, `CLOSE_TIMEOUT_MS`, `CREDENTIAL_INSTALL_TIMEOUT_MS`, `PUSH_LOG_MAX_COMMITS` (`constants.ts`), `GitAuthor`, `PushPolicy`, `Git*Result` (`types.ts`) |
| `context/` | `provideSandboxContext()`, `injectSandboxContext()` (`module.ts`), `SANDBOX_CONTEXT` (`constants.ts`, internal; key `sandbox`) |
| `module/` | The `/module` entry (the only folder importing `@chamvi/app`): `sandboxModule()`, `SandboxModule` (`module.ts`), `createLazyProvider()` (`provider.ts`), `isPackageNotFound()` (a copy of the app's), `loadPackage()`, `readImageAllowList()` (`CHAMVI_SANDBOX_IMAGES`) (`asserts.ts`), `SANDBOX_MODULE_NAME`, `SANDBOX_PROVIDER_NAMES` (public), `SANDBOX_PROVIDER_PACKAGES`, `SANDBOX_PROVIDER_IDS` (`constants.ts`), `SandboxModuleOptions`, `SandboxProviderName` (public region) and the structural provider package types (`types.ts`) |

`@chamvi/sandbox-local` (`packages/sandbox-local/src/provider/`): `createLocalSandbox()` (`module.ts`, `find` from the records), `LocalWorkspace` (`workspace.ts`, spawn per exec in its own process group), `collectExpired()`, `listRecords()` (`gc.ts`), `killLingeringJobs()`, `trackLingering()` (`exit.ts`, the process `exit` listener), `buildEnv()`, `killGroup()`, `exitCodeOf()`, `toRecord()`, `parseRecord()` (`helpers.ts`), `WorkspaceRecord`, `ParsedRecord` (`types.ts`, internal), `LOCAL_PROVIDER_NAME`, `REPO_DIR`, `WORKSPACE_RECORD`, `CACHE_DIR_NAME`, `KILL_GRACE_MS` (`constants.ts`, internal; only `createLocalSandbox` is exported).

## Docker Sandbox Module Map (`packages/sandbox-docker/src`)

| Path | Purpose |
|------|---------|
| `provider/` | `createDockerSandbox()` (`module.ts`), `buildContainerOptions()`, `assertDockerOptions()`, `pullImage()`, `removeContainer()` (`asserts.ts`, internal), `openCache()`, `CACHE_OPEN_SCRIPT` (`cache.ts`, internal), `DEFAULT_NETWORK`, `CONTAINER_NAME_PREFIX`, `DEFAULT_USER` (public), `CACHE_OPEN_USER`, `CACHE_OPEN_TIMEOUT_MS` (internal) (`constants.ts`), `DockerSandboxOptions` (`types.ts`) |
| `transport/` | No barrel: `createDockerTransport()`, the `IExecTransport` over the Docker exec API (demuxed streams into the workspace's sinks, exit code by inspect poll, `alive` by container inspect) |

## Kubernetes Sandbox Module Map (`packages/sandbox-k8s/src`)

| Path | Purpose |
|------|---------|
| `provider/` | `createKubernetesSandbox()` (`module.ts`), `buildPod()`, `podState()`, `assertKubernetesOptions()`, `loadDefaultKubeConfig()` (`asserts.ts`, internal), `CONTAINER_NAME`, `POD_NAME_PREFIX`, `START_TIMEOUT_MS`, `POLL_MS`, `FATAL_WAITING_REASONS` (`constants.ts`), `KubernetesSandboxOptions`, `PodUser` (`types.ts`) |
| `client/` | `createPodClient()` (`module.ts`), `createPodClientFrom()` (`asserts.ts`, the test seam over `core`/`exec`), `IPodClient` and parts (`types.ts`), `STDIN_CLOSE_PROTOCOL` (`v5.channel.k8s.io`) |
| `transport/` | No barrel: `createPodTransport()`, the `IExecTransport` over `IPodClient.exec` (`alive` by pod read) |

## Coding Module Map (`packages/coding/src`)

| Path | Purpose |
|------|---------|
| `tools/` | `codingTools()` (`module.ts`); `read_file`, `write_file` (`files.ts`), `edit_file`, `multi_edit` (`edit.ts`), `grep`, `glob`, `list_files`, `parseMatches()`, `grepResult()` (`search.ts`), `bash` (`shell.ts`), `bash_output`, `bash_kill`, `startJob()` (`jobs.ts`), `git_diff` (`git.ts`); the report parser `parseReport()`, `excerptOf()`, `completeLength()` (`output.ts`, internal); input checks, `workspaceOf()`, `objectSchema()`, `homeLogPath()`, `imageTypeOf()`, `linesOf()`, `fileKey()`, `createKeyedQueue()`, `readRawText()` (`helpers.ts`); `READ_MAX_LINES`, `READ_MAX_CHARS`, `SEARCH_MAX_RESULTS`, `LIST_MAX_RESULTS`, `LINE_MAX_CHARS`, `OUTPUT_LOG_MAX_BYTES` (public), the excerpt, job, binary and image limits and the sh scripts (`BASH_SCRIPT`, `INNER_SCRIPT`, `REPORT_SCRIPT`, `JOB_*_SCRIPT`, `GREP_SCRIPT`, `READ_LOG_SCRIPT`) (`constants.ts`); result types and `CodingToolsOptions` (`types.ts`: `BashResult`, `BashJobResult`, `BashOutputResult`, `BashKillResult`, `ReadFileBinaryResult`, `ReadFileImageResult`, `MultiEditResult`, `GrepEngine`, `GlobResult`, ...) |
| `backend/` | `ICodingBackend`, `CodingTask`, `CodingResult`, `CodingBudget` (types only) |

## Web Tools Module Map (`packages/tool-web/src`)

| Path | Purpose |
|------|---------|
| `address/` | No barrel: `parseAddress()`, `isBlockedAddress()` (`module.ts`), `BLOCKED_IPV4`, `BLOCKED_IPV6` (`constants.ts`) |
| `url/` | `parseWebUrl()`, `checkUrl()` (`module.ts`: `allowUrl`, then the address check over `lookup`), `systemLookup` (`lookup.ts`, `dns.lookup` with every address), `WebAddress`, `WebLookup`, `WebUrlPolicy` (`types.ts`, the only export) |
| `request/` | `getPage()` (`module.ts`: the hapic GET, manual redirects each through `checkUrl`, the timeout on the `IClock`), `requestError()`, `messageOf()`, `readCapped()` (`asserts.ts`), `WEB_FETCH_MAX_BYTES`, `WEB_TIMEOUT_MS`, `WEB_MAX_REDIRECTS`, `WEB_REQUEST_ERROR_CODE` (`constants.ts`, exported), `WebResponse` (`types.ts`, internal) |
| `options/` | `normalizeOptions()` (`module.ts`, `InvalidAgentDefinitionError` for bad options), `TIMER_MAX_MS` (`constants.ts`), `WebToolsOptions` (exported) and `WebToolsOptionsNormalized` (`types.ts`) |
| `html/` | No barrel: `mediaTypeOf()`, `isHtml()`, `isText()`, `decodeBody()`, `htmlToMarkdown()`, `htmlToText()` (`module.ts`, both through mdream), `TEXT_MEDIA_TYPES`, `PAGE_CHROME_ELEMENTS`, `FRONTMATTER` (`constants.ts`), `ConvertedPage` (`types.ts`) |
| `tools/` | `webTools()` (`module.ts`), `webFetchTool()` (`fetch.ts`), the tool input helpers `inputObject()`, `requireString()`, `optionalInteger()`, `optionalOneOf()`, `signalOf()`, `cutText()`, `objectSchema()` (`asserts.ts`), `WEB_FETCH_MAX_CHARS` (exported), `WEB_FETCH_FORMATS`, `UNTRUSTED_NOTE` (`constants.ts`), `WebFetchFormat`, `WebFetchResult` (`types.ts`) |

## App Module Map (`packages/app/src`)

| Path | Purpose |
|------|---------|
| `app/` | `createApp()`, `isApp()` and the `App` class (`module.ts`, the lifecycle: one orkos `Application` over a fresh eldin `Container` per `start`/`check`/`runJob`/`migrate` (`check()`: the start path without its start steps, writing nothing), memoized `stop()`), `buildModules()` (built-ins replaced by name, duplicate names refused), `toSetupError()` (orkos graph errors as `InvalidAgentDefinitionError`), `createInUseError()`, `createStopFailedError()` (`asserts.ts`), `APP_BRAND` (`constants.ts`), `AppOptions` (optional `conversations: { authorize, limits? }`), `IApp` and the lifecycle option/result types (`types.ts`) |
| `module/` | `AppToken`, `ModuleName`, `AUTHENTICATOR_ORDER`, `APP_ERROR_CODE` (`constants.ts`), `runHooks()`, `throwIfStopped()`, `reportingModule()`, `createStoppedError()` (`asserts.ts`, the last two internal), `registerStartStep()`, `runStartSteps()` (`start.ts`, internal: the engine start (and so its channels') and the http serve step, run once every `onReady` built), `AppContext`, `ILifecycleHook`, `AuthenticatorEntry`, `Server`, `AppTokens` and the re-exported orkos `IModule` and eldin `IContainer` types (`types.ts`); with the env readers and `approvalUrlOf()` the module contract feature packages import from the main entry |
| `env/` | `TIMER_MAX_MS` (`constants.ts`), `envString()`, `envInteger()`, `envBoolean()`, `envUrl()`, `envList()`, `envJson()`, `envOneOf()` (`module.ts`, never echoing a value), `Env` and the reader options (`types.ts`) |
| `config/` | `readConfig(env, { mode, dev })` (`module.ts`), `readTokens()`, `approvalUrlOf()` (`asserts.ts`), defaults and patterns (`constants.ts`), `AppConfig`, `LogLevel`, `ReadConfigOptions`, `ApprovalRef` (`types.ts`) |
| `logger/` | `createLogger()` (`module.ts`, JSON lines on stderr), `serializeError()`, `toLine()` (`asserts.ts`), `LOG_LEVEL_RANK` |
| `loader/` | `loadAgent()`, `loadAgents()`, `listAgentFolders()`, `hashAgentFolder()` (`module.ts`), `readFreshModule()`, `createModuleJiti()`, `readModule()`, `createPackageAliases()`, `relativize()`, `isHashIgnored()` (`asserts.ts`, internal), `AGENT_FILE` (`agent.ts`), `SCRIPT_EXTENSIONS`, `HASH_IGNORE_PATTERNS`, `HASH_IMPORTABLE_EXTENSIONS`, the name rule (`constants.ts`, internal), `LoadedAgent`, `AgentLoadIssue`, `LoadAgentOptions`, `LoadAgentsResult` (`types.ts`); the only `locter`/`jiti` importer |
| `models/` | No `module.ts`: `readModelSettings()` (`settings.ts`: code, `chamvi.json` and env merged per provider and field into `ModelSettings` plus `ModelIssue`s), `readConfigFile()` (`file.ts`), `readSecret()` (`secret.ts`, `SecretValue` from the app env or a file), `createModelResolver()` (`resolver.ts`, internal: the engine's `IModelResolver`, providers built once with explicit key and base URL, `errors` for packages not installed), `isPackageNotFound()`, `defaultImporter()`, `providerEnvName()`, `providerName()`, `isProviderName()`, `isProviderType()`, `headerName()`, `assertHeaderName()`, `splitModelRef()`, `assertBaseUrl()`, `describeBaseUrl()` (`helpers.ts`), `BUILTIN_PROVIDERS` (public), `MODEL_SEPARATOR`, `PROVIDER_TYPES`, `SECRET_HEADER_PATTERN`, `HEADER_NAME_PATTERN`, `DEFAULT_CONFIG_FILE` (`constants.ts`), `ModelProviders`, `ProviderType`, `SecretValue`, `ProviderConfig`, `SettingSource`, `ProviderSettings`, `ModelSettings`, `ModelIssue`, `BuiltinProvider` (`types.ts`, public region) and the internal `ModelResolverOptions`, `ModelResolver` |
| `core/` | The re-export of `@chamvi/core` and named `@chamvi/http` symbols (the documented exception, see conventions) |
| `modules/` | The built-ins, one folder each: `config/`, `repository/` (`AppToken.STORE` aggregate on one DataSource or the app clock; `purge.ts` the purge timer, `maskPassword()`, `destroyQuietly()`, `isPurgingRepository()` in `asserts.ts`), `static-tokens/` (the dev `*` token), `engine/`, `agents/` (`AgentsModule`, `agentsModule()` in `module.ts`; `createAgentsWatcher()` in `watcher.ts`, internal; `AGENTS_WATCHER_HOOK_NAME`, the messages (`AGENT_RELOADED_MESSAGE`, `AGENT_REMOVED_MESSAGE`, `JOB_CONFLICT_HINT`) and `HASH_PREFIX_LENGTH` in `constants.ts`; the watcher roles `start`/`job`/`check` in `types.ts`), `scheduler/` (contributes `cronChannel()`; without `CHAMVI_SCHEDULER` in start mode a `cron` channel that validates but never fires), `http/` (contributes the `http`, `mcp` and `webhook` channels, mounts every contributed channel with an `in`; `resolveAuthenticators()` in `asserts.ts`), `console-channel/` (`consoleChannelModule()`, `chamvi:console`) |
| `authup/` | The `/authup` entry: `authupModule()` (`module.ts`), `oidcModule()` (`oidc.ts`), `*_MODULE_NAME` and the options types (they stay here: moving them to `@chamvi/http` would make http depend on app, a cycle) |
| `testing/` | The `/testing` entry: `buildModuleHarness()`, `createModuleHarness()` (`module.ts`, the real module lifecycle over the given modules: `reportingModule()`, `runStartSteps()`), `ModuleHarness`, `ModuleHarnessOptions`, `ModuleHarnessReport` (`types.ts`) |

## CLI Module Map (`packages/cli/src`)

| Path | Purpose |
|------|---------|
| `cli.ts` | The bin: `await runCli(process.argv.slice(2), processContext(fileURLToPath(import.meta.url)))` |
| `run/` | `runCli()` (`module.ts`: `--help`/`--version`, citty `runCommand`, errors to stderr with `exitCodeOf`), `processContext()`, `exitCodeOf()`, `createUsageError()`, `assertKnownArgs()`, `messageOf()`, `isRecord()` (`asserts.ts`), `EXIT_CODE`, `CLI_USAGE_ERROR_CODE` (public), `CITTY_ERROR_NAME`, `USAGE_ERROR_CODES`, `APP_STOPPED_ERROR_CODE` (`constants.ts`), `CliContext` (`types.ts`) |
| `commands/` | `createMainCommand()` (`module.ts`), one file per command (`dev.ts`, `build.ts`, `start.ts` (incl. `--check`), `run-job.ts`, `migrate.ts`), `readVersion()`, `loadDotEnv()` (`node:util` `parseEnv`) (`helpers.ts`), `CHECK_PASSED_MESSAGE`, `FORCE_EXIT_MS`, `DEV_FORCE_EXIT_MS`, `DEV_LINK_VARIABLE`, `BUILD_OUT_DIR`, `BUILD_OUTPUT_PATTERN`, `TSDOWN_PACKAGE`, ... (`constants.ts`) |
| `entry/` | `resolveEntry()` (`--entry`, `package.json` `chamvi.entry` for source commands only, `SOURCE_ENTRY`/`BUILT_ENTRY`), `loadApp()` (`isApp` check), `loadEntryApp()` (the default app without an entry) (`module.ts`), `DEFAULT_APP_NOTICE` (`constants.ts`), `EntryKind`, `ResolveEntryInput` (`types.ts`); not re-exported from the main entry |
| `signals/` | `installSignalHandlers()` (`module.ts`: first signal stops, a second one at least `SIGNAL_REPEAT_MS` (`constants.ts`, 1 s) later exits 1, the force-exit timer on the `IClock`, kept alive), `ISignalTarget` (public), `ProcessEvent`, `StopSignal`, `SignalHandlersInput`, `SignalHandlers` (`types.ts`) |

## Repository-TypeORM Module Map (`packages/store-db/src`)

| Path | Purpose |
|------|---------|
| `entities/` | One TypeORM entity per table, the repositories the store queries through; `TableName` and the jsonb transformers (`JSON_VALUE_TRANSFORMER`, `OPTIONAL_JSON_TRANSFORMER`) in `constants.ts`, `toJsonParameter()` (jsonb sanitizing) in `asserts.ts` |
| `migrations/` | `1792195200000-init.ts` (`Init1792195200000`), `1792368000000-artifacts.ts` (table `chamvi_artifacts`), generated from the entities; `1792454400000-idempotency-scope.ts` (`scope` varchar(1024), hand-written), `1792540800000-kv-key-collation.ts` (`chamvi_kv.key` `COLLATE "C"`, hand-written), `1792627200000-agent-revisions.ts` (`AgentRevisions1792627200000`, table `chamvi_agent_revisions`); `1792713600000-conversations.ts` (four conversation-owned tables, scalar run/checkpoint bindings, and eleven constraints generated from standard TypeORM relationships, including checkpoint/step run ownership; generated as one migration from entity metadata) |
| `conversation/` | `DatabaseConversationRepository` on the run DataSource, transaction-bound repository getters, shared core persistence policy and local options; identity-row locking, generation fences, journal and note-operation transactions, bounded operation-prune pages |
| `schema/` | `migrateStore()`, `pendingMigrations()` (`module.ts`), `STORE_ENTITIES`, `STORE_MIGRATIONS`, `MIGRATION_LOCK_NAME` |
| `repository/` | `createDatabaseStore()` (`module.ts`), entity to domain mapping, value builders and `RETURNING` row hydration (`helpers.ts`), `DatabaseStoreOptions`, `DatabaseStore` |
| `run/`, `step/`, `checkpoint/`, `idempotency/`, `lock/`, `effect/`, `state/`, `artifact/`, `agent-revision/` | Separate `Database*Repository` capability classes; idempotency and lock repositories each own numeric `purgeExpired()` |

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
| `app/approvals/` | `useApprovals()`, `useLinkedApproval()` (`composables.ts`), `pendingApprovals()`, `notifiedLine()`, `readApprovalLink()`, `approvalLinkQuery()`, `linkedApprovalState()`, `linkNotice()`, `canApprove()`, `isDiffDetail()`, `detailLines()` (`helpers.ts`), `DetailLine` (`types.ts`), `INBOX`, `INBOX_POLL_MS`, `INBOX_PAGE_SIZE` (`constants.ts`) |
| `app/agents/` | `useAgents()`, `useAgentRollups()` (overview), `useAgentDetail()` (agent page, `start()`) (`composables.ts`); `channelChips()`, `summarizeActivity()`, `buildRollups()`, `activityLabel()`, `createStartKeys()`, `newIdempotencyKey()`, `failedSummary()`, `tokenShares()`, `nextFireOf()`, `lastRunOf()`, `oldestWaiting()`, `hasHttpSubscription()`, `matchesName()`, `parsePayload()`, `formatBudgetTime()` (`asserts.ts`); `ACTIVITY_WINDOW_MS`, `ACTIVITY_LIMIT`, `ACTIVE_LIMIT`, `AGENTS_POLL_MS`, `RECENT_RUNS`, `AGENT_WAITING_LIMIT` (`constants.ts`); `ChannelChip`, `Activity`, `AgentRollup` (`types.ts`) |
| `app/state/`, `app/schedules/` | `useAgentState()`, `useSchedules()` and their helpers (`describeCron()` in `schedules/helpers.ts`) |
| `app/components/` | One folder per component: `app-shell`, `brand-logo`, `nav-icon` (`IconName`, the mockup's glyphs), `page-head`, `empty-state`, `status-chip`, `channel-chip`, `json-block`, `step-item`, `usage-meter`, `approval-callout`, `expiry-countdown`, `runs-table`, `schedule-card`, `activity-strip`, `agent-card`, `agent-runs`, `agent-state` (`AgentStatePanel`), `start-run` (`StartRunModal`), `tab-list` (`TabList`, the ARIA tabs pattern: roving tabindex, arrow keys, `tabForKey()`) |
| `app/views/` | `LoginView`, `LoginCallbackView`, `AgentsView`, `AgentView`, `RunsView`, `RunView`, `ApprovalsView`, `SchedulesView` |
| `vite.config.ts` | Root `app`, out `dist/app`, `base: './'` for the build, the dev proxy to port 3000, the `virtual:chamvi-icons` plugin |
| `test/e2e/` | `smoke.spec.ts` (Playwright), `demo/` (`server.ts`, `model.ts`, `constants.ts`) |

## Skills Module Map (`packages/skills/src`)

`prepare/` owns `prepareSkills()` (`module.ts`) and Chamvi-owned `PrepareSkillsOptions`/`PreparedSkill` (`types.ts`). The pinned external SDK supplies parsing, cloning, discovery and copying; no SDK types or app imports reach the package main entry.

`packages/skills/src/bundle/` owns all filesystem hashing, verification and immutable bundle loading. `source/` exports pure `gitSkills()` from the main entry. `prepare/` accepts owned cancellation and joins SDK cloning before cleanup. App exports no filesystem skill helpers and has no dependency on the optional skills package. `catalog/` owns `Skill`, identities/metadata, `ISkillSource`, `SkillCatalog`, `LoadedSkill`, validation, `createSkillCatalog()` and scoped `load_skill`. `runtime/` owns `defineSkill()`/`defineSkillSource()`, the provider and per-engine weak caches/fingerprints. Core owns only the generic preparation/contribution protocol and lifecycle orchestration, with no skills package dependency.
