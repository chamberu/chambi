# Sandboxes

The sandbox packages: `@chamvi/sandbox` (contracts, rules, the workspace manager) and the three providers. See [Workspaces & Coding](/guide/workspaces) for the behaviour.

## @chamvi/sandbox

```bash
npm install @chamvi/sandbox @chamvi/core ai --save
```

`@chamvi/core` and `ai` are peer dependencies.

### createWorkspaceManager

```ts
function createWorkspaceManager(options: WorkspaceManagerOptions): IWorkspaceManager;

const MAX_WORKSPACES_PER_RUN: 3;
const GC_INTERVAL_MS: 600_000;
const CLOSE_TIMEOUT_MS: 30_000;
const CREDENTIAL_INSTALL_TIMEOUT_MS: 30_000;
const PUSH_LOG_MAX_COMMITS: 50;

```

Throws `InvalidAgentDefinitionError` for a provider without `create`, `find` and `collectGarbage`, an empty `image`, invalid `env` or `limits`, a `deployment` that is no label value, an `allowRepo`, `allowImage`, `isSettled` or `onError` that is no function, a `maxWorkspacesPerRun` below 1, a negative `gcIntervalMs`, `credentials` that are no sources with `get()`, a `depth` below 1, an `author` without a non-empty `name` and `email` (no line break, `<` or `>`) or a malformed `push`.

With `credentials` the manager looks up a read credential for every checkout (`checkout.credential` of the create; a failing source fails the create with a `SandboxError` naming the repository) and hands out each workspace through a view whose exec results, file reads and errors carry `[redacted]` in place of every issued token and whose `redact(text)` does the same for text a tool decodes itself. Only the tokens this process issued are redacted, each until `REDACT_GRACE_MS` after its `expiresAt` (a static token without expiry stays); the credentials file of a workspace found again (after a restart or on another replica) is never read back, since the model can write it. The view also has `readFileRaw(path)`, the unredacted text, and `redactedSpans(text)`, which the edit tools use: they match oldString against the redacted text the model read (`redactedSpans`), refuse an edit that touches a `[redacted]` span and put every untouched token back byte for byte, so an oldString can neither probe a token nor write `[redacted]` back. Without an image allow-list (`allowImage`), and on the local provider, `create_workspace` has no `image` parameter and a requested image is a `ValidationError` before any create. It writes the credential helper and the credentials file of an https workspace after the create and before the first exec of a workspace this process has not written yet (one found again), and again before an exec once a token expires within `CREDENTIAL_REFRESH_MS` (at most once per `CREDENTIAL_RETRY_MS` while a source keeps answering a token inside that window); a failing write goes to `onError` and is tried again `CREDENTIAL_RETRY_MS` later, never failing the exec. The file holds the repository's write credential (else its read one, also when the write lookup fails, which goes to `onError`) and the host's (a request with an empty `path`).

On a miss (`get` without a held workspace that fits, `acquire` of a repository it does not hold) the manager asks `provider.find(runId, { deployment })` once per run at a time and adopts what it finds, so a run reaches its workspaces after a restart or on another replica. `release(runId)` (and `attach` for a settled run) disposes the held workspaces and every one `find` reports; with `isSettled`, `attach` skips the `find` for a settled run this process neither holds nor looks up and starts a garbage collection instead (at most one per `gcIntervalMs`), which removes what other processes left for it; `close()` disposes nothing a live run holds, `close({ dispose: true })` disposes those too.

<<< ../../../sandbox/src/manager/types.ts{ts}

### Repository instructions

```ts
function readRepositoryInstructions(
    workspace: IWorkspace,
    paths?: readonly string[],
    options?: ReadRepositoryInstructionsOptions,
): Promise<RepositoryInstructions>;

type ReadRepositoryInstructionsOptions = { signal?: AbortSignal; clock?: IClock };
type RepositoryInstructionSource = {
    path: string;
    sha256: string;
    content: string;
    scopes: string[];
    includedBy: string[];
};
type RepositoryInstructionDiagnosticCode = 'missing-include' | 'unreadable' | 'invalid-utf8'
    | 'outside-workspace' | 'unsupported-file' | 'cycle' | 'limit';
type RepositoryInstructionDiagnostic = {
    path: string;
    code: RepositoryInstructionDiagnosticCode;
    message: string;
};
type RepositoryInstructions = {
    commit: string | null;
    paths: string[];
    sources: RepositoryInstructionSource[];
    diagnostics: RepositoryInstructionDiagnostic[];
    complete: boolean;
};
```

`clock` defaults to `systemClock` and measures the request deadline; `signal` cancels collection. The function works through `IWorkspace.exec`, without host filesystem reads or repository program execution. The manager's `read_repository_instructions({ paths?, workspace? })` resolves the calling run's workspace and forwards its cancellation signal. Paths default to `['.']`, follow workspace path normalization (relative or `/workspace/...`), and existing directories include themselves; files and missing targets use their parent.

`create_workspace` adds `instructions: RepositoryInstructions | null` to `WorkspaceToolResult`. Repository-backed creates, including reuse or adoption, collect root guidance afresh. Repo-less creates return `null`. A collection failure (a missing utility, a stray stderr line, an exec timeout) returns `instructions: null` plus `instructionsError` (the redacted reason) rather than failing the create; a cancelled run still rejects. With `createWorkspaceManager({ provider, repositoryInstructions: false })`, `create_workspace` returns `instructions: null` and the explicit tool is omitted; the default is `true`. `sandboxModule({ repositoryInstructions: false })` forwards this manager option. There is no corresponding environment variable. The separate [`codingTools` option](/reference/coding#repository-instructions) controls text-read attachments independently.

Entrypoint discovery visits root and requested ancestors only, ordered by directory depth then JavaScript string order; explicit includes may reference permitted files elsewhere in the workspace. Each directory reads `AGENTS.md` before `CLAUDE.md`, each immediately followed by its included files in depth-first textual order. Only standalone `@relative/path` lines count, with surrounding whitespace allowed and none within the path. Ordinary links, inline `@` text and fenced code are ignored. Fences use at least three backticks or tildes; a closing fence uses the same character with at least the opening length. Includes resolve relative to their source, allowing `..` only inside the workspace and refusing absolute paths, home paths, URLs, NUL and escapes.

Sources are deduplicated by canonical workspace-relative path; `scopes` retains every applicable entrypoint directory (`.` for root) and `includedBy` every including parent. Included guides inherit their entrypoint's scope. `sha256` hashes exact original bytes, before credential redaction; `content` is strictly decoded UTF-8 and redacted before include parsing. Outward paths and diagnostics are redacted too. The collector preserves provenance rather than resolving contradictory prose. `commit` is `workspace.info.commit ?? null`, the recorded checkout commit, not necessarily current HEAD; hashes identify the bytes actually read. There is no transactionally frozen snapshot and no cache across calls.

| Exported bound | Value |
|---|---|
| `INSTRUCTION_FILES` | `['AGENTS.md', 'CLAUDE.md']` |
| `INSTRUCTION_SOURCE_MAX_BYTES` | 32 768 (32 KiB), each source whole or omitted |
| `INSTRUCTION_TOTAL_MAX_BYTES` | 131 072 (128 KiB), total source bytes |
| `INSTRUCTION_SOURCES_MAX` | 32 distinct sources |
| `INSTRUCTION_INCLUDE_DEPTH_MAX` | 8 include edges from an entrypoint |
| `INSTRUCTION_PATHS_MAX` | 32 requested paths |
| `INSTRUCTION_DIRECTORIES_MAX` | 64 distinct ancestor directories, root included |
| `INSTRUCTION_REFERENCES_MAX` | 512 attempted inspections and include references |
| `INSTRUCTION_DIAGNOSTICS_MAX` | 64 entries, including a closing limit diagnostic |
| `INSTRUCTION_DIAGNOSTICS_MAX_BYTES` | 8192 UTF-8 bytes of diagnostic paths and messages together |
| `INSTRUCTION_PATH_MAX_BYTES` | 4096 UTF-8 bytes per path |
| `INSTRUCTION_REQUEST_TIMEOUT_MS` | 30 000 (30 s) per request |
| `INSTRUCTION_EXEC_TIMEOUT_MS` | 5000 (5 s) per exec |

Missing optional entrypoints are normal. Missing explicit includes, unreadable files, invalid UTF-8, refused paths, cycles and bound exhaustion add diagnostics; any diagnostic makes `complete: false`. Sources are never silently truncated. Invalid input shapes throw `ValidationError`; cancellation, workspace lookup failures, transport errors, exec timeouts, missing inspection capabilities and malformed or truncated protocol responses reject through the existing error path, never a successful empty result. The overall request deadline produces a `limit` diagnostic with the sources collected so far.

Fixed discovery scripts run in the physical workspace cwd and resolve utilities on `/usr/bin:/bin`, excluding repository executables. Each read is bounded to 32 KiB + 1 byte with framed base64 output, checked against the 65 536-byte transport cap, exit status, timeout, truncation flags, lengths and completion marker. Missing utilities produce an explicit failure; there is no interpreter or image-contract expansion. Every observed symlink component (including aliases within the workspace), special file and `.git` component is refused. Checks are best-effort against the observed filesystem; concurrent changes can race them. Strict race-free confinement is deferred to [#92](https://github.com/chamvi/chamvi/issues/92).

Delivered context is ordinary tool output retained in model messages, steps and checkpoints across approval pauses and recovery. The next create, explicit context call or applicable file read collects current guidance, including changed files in a reused or recovered workspace, without replacing older messages. These tools are not effect tools. See [Repository instructions](/guide/workspaces#repository-instructions) for the pre-edit workflow and authorization boundaries.

### Git credentials

```ts
function staticGitCredentials(entries: readonly StaticGitCredential[]): IGitCredentials;

const REDACTED: '[redacted]';
const CREDENTIAL_REFRESH_MS: 600_000;
const CREDENTIAL_RETRY_MS: 60_000;
const CREDENTIALS_FILE: '.chamvi/credentials'; // below $HOME, mode 0600
const REDACT_MIN_LENGTH: 4;
const REDACT_GRACE_MS: 3_600_000;   // an expired token stays redacted this long
```

`staticGitCredentials` throws `InvalidAgentDefinitionError` for an entry without a host name (an optional port), a token or username with NUL, CR, LF or tab, or a `path` that is no owner or repository, naming the entry and never a token. A source's answer must be non-empty strings without those characters (`expiresAt` a `Date`), else the lookup is a `SandboxError`.

The structured Git tools run every remote call as `git -c credential.helper= -c core.hooksPath=/dev/null ...`, or with a credential as `sh -c <script> sh <url> <origin> <path> <git args>` with `<username>\n<password>\n` on stdin: the script hands the credential to git through a one-shot helper on fd 3 that answers only for that origin and path. A URL-specific key in the repository's or the global git config beats a generic `-c`, so the script cannot force settings on; it checks the config for the URL first and refuses (a `SandboxError` naming the keys, nothing sent) when it sets a proxy (`http.proxy`, `remote.<name>.proxy`), turns `http.sslVerify` off, names another CA (`http.sslCAInfo`, `http.sslCAPath`), overrides name resolution (`http.curloptResolve`) or rewrites URLs (`url.<base>.insteadOf`, `pushInsteadOf`). It also allows git only the https transport (`GIT_ALLOW_PROTOCOL=https`, which no config can override), so a transport the config names for the URL (`remote.<url>.vcs`) never starts and cannot read the credential git hands its helpers. The workspace helper (`$HOME/.chamvi/git-credential`, set as the global `credential.helper` with `credential.useHttpPath`) answers from the credentials file, the repository's line first, else the host's.

<<< ../../../sandbox/src/credentials/types.ts{ts}

### Workspaces and providers

<<< ../../../sandbox/src/workspace/types.ts{ts}

<<< ../../../sandbox/src/provider/types.ts{ts}

<<< ../../../sandbox/src/workspace/constants.ts{ts}

<<< ../../../sandbox/src/provider/constants.ts{ts}

### Rules

```ts
function normalizeRepo(input: string, options?: NormalizeRepoOptions): string;
function assertGitRef(ref: string): void;
function resolveWorkspacePath(path: string): string;
function resolveLimits(...layers: Array<SandboxLimits | undefined>): Required<SandboxLimits>;
function parseCpu(value: string): number;
function parseMemory(value: string): number;
function assertSandboxEnv(env: Record<string, string> | undefined): void;
function prepareWorkspace(
    workspace: IWorkspace,
    input: { repo?: string; ref?: string; depth?: number; credential?: GitCredential; signal?: AbortSignal },
): Promise<{ commit?: string; defaultBranch?: string }>;
function readCheckout(workspace: IWorkspace, signal?: AbortSignal, clock?: IClock): Promise<{ commit?: string; defaultBranch?: string } | undefined>;
function createOutputCollector(maxBytes: number): IOutputCollector;
```

For provider authors, the workspace metadata `find` rebuilds the info from:

```ts
function assertDeployment(value: unknown): string; // DEFAULT_DEPLOYMENT for undefined, else a label value or ValidationError
function repoKey(repo: string): string;            // 32 hex of the URL's sha256, a label value
function workspaceLabels(input: { id: string; runId: string; deployment: string; repo?: string }): Record<string, string>;
function workspaceMetadata(info: WorkspaceInfo): Record<string, string>; // created, expiry, repo, ref, image
function readWorkspaceInfo(values: Readonly<Record<string, string | undefined>>, provider: string): WorkspaceInfo | undefined;
function createSettledCheck(isSettled?: (runId: string) => Promise<boolean>): (runId: string) => Promise<boolean | SandboxError>;
function lifetimeSeconds(info: Pick<WorkspaceInfo, 'createdAt' | 'expiresAt'>): number; // whole seconds, rounded up, at least 1: how long a container or pod sleeps
```

`normalizeRepo`, `assertGitRef` and `resolveWorkspacePath` throw `ValidationError` (model input); `resolveLimits`, `parseCpu`, `parseMemory` and `assertSandboxEnv` throw `InvalidAgentDefinitionError` (configuration); `prepareWorkspace` throws `SandboxError` with git's stderr when a checkout step fails, records the default branch as `git config chamvi.defaultBranch` and, as its last step, the checkout as `git config chamvi.checkout` (the commit, or `none` without a repo). `readCheckout` reads both back: `{ commit, defaultBranch? }`, `{}` for a repo-less workspace, `undefined` for a create that died before its checkout finished, which `find` must skip.

### Images, privileges and the cache

```ts
function assertImage(value: unknown): string;               // an image reference, else ValidationError (never echoed)
function probeImage(transport: IExecTransport, options: { image: string; clock?: IClock; signal?: AbortSignal }): Promise<void>;
function cacheEnv(dir: string): Record<string, string>;     // CACHE_ENV's variables under another folder (local)
function isRootUser(user: string | number): boolean;        // 0, '0:<gid>', 'root', 'root:<group>'
function assertTmpSizeOption(value: unknown): void;         // a positive memory quantity, else InvalidAgentDefinitionError

const CACHE_DIR: '/cache';
const WORKSPACE_HOME: '/home/sandbox';                      // HOME of a container or pod workspace, a disk-backed volume of its own
const CACHE_ENV: Readonly<Record<string, string>>;          // XDG_CACHE_HOME, npm_config_cache, PIP_CACHE_DIR, GOMODCACHE, GOCACHE, COMPOSER_CACHE_DIR
const ROOT_CAPABILITIES: readonly string[];                 // CHOWN, DAC_OVERRIDE, FOWNER, FSETID, SETUID, SETGID, KILL
const IMAGE_REQUIREMENTS: readonly string[];                // sh, git, timeout (with -k), head, base64, tr
const IMAGE_PROBE_TIMEOUT_MS: 30_000;
```

`probeImage` runs one `sh -c` script straight on the transport (every workspace exec goes through `timeout`, which may be what is missing), right after the container or pod started and before the checkout: a `SandboxError` names what the image lacks (`git`, `timeout`, `a timeout that supports -k`, `sh` when the script cannot start, `sh at /bin/sh`, or `head`, `base64` or `tr` missing from `/usr/bin` and `/bin`, the only directories the repository guidance collector resolves them in), or why the probe failed (no answer within `IMAGE_PROBE_TIMEOUT_MS` on the clock). Docker and Kubernetes add `ROOT_CAPABILITIES` back for a root user only and mount `/cache` with `CACHE_ENV` in every workspace.

### Remote workspaces

```ts
function createRemoteWorkspace(input: RemoteWorkspaceInput): IWorkspace;

const TIMEOUT_KILL_AFTER_SECONDS: 5;
const EXEC_GRACE_MS: 15_000;
const ALIVE_PROBE_TIMEOUT_MS: 5_000;
```

A provider that can run argv in a container implements `IExecTransport`: it runs argv, streams stdout and stderr into the sinks it is given and resolves the exit code. `createRemoteWorkspace` adds the rest: the `sh -c` script that enters the working directory, runs the command behind the timeout wrapper and reports its exit on stderr (so an exec returns about 2 s after the command exited, even when a background job holds its output), the guard, path checks, output caps, file reads and writes, dispose. After a failed exec it asks `alive()` (at most `ALIVE_PROBE_TIMEOUT_MS`); `false` marks the workspace gone (`disposed`).

<<< ../../../sandbox/src/remote/types.ts{ts}

### Context

```ts
function provideSandboxContext(provider: IContextProvider, manager: IWorkspaceManager): void; // engine.provide under the key 'sandbox'
function injectSandboxContext(ctx: ToolContext): IWorkspaceManager;                         // else ContextNotProvidedError
```

`sandboxModule()` provides its manager; with a hand-built engine call `provideSandboxContext(engine, manager)` after `new Engine()`. A tools factory then builds the workspace and coding tools per execution: `tools: (ctx) => { const manager = injectSandboxContext(ctx); return { ...manager.tools(), ...codingTools(manager) }; }`. See [Context](/guide/tools#context-shared-instances-for-tools).

### Module

```ts
// @chamvi/sandbox/module, needs @chamvi/app
function sandboxModule(options?: SandboxModuleOptions): SandboxModule; // name SANDBOX_MODULE_NAME 'chamvi:sandbox', .manager: IWorkspaceManager

const SANDBOX_PROVIDER_NAMES: readonly SandboxProviderName[]; // ['local', 'docker', 'kubernetes']
```

Git credentials: the `credentials` option, then the tokens of `CHAMVI_GIT_TOKENS` (a JSON list of `StaticGitCredential`; an error names the variable and the entry, never a token), then every source other modules contribute to `AppToken.GIT_CREDENTIALS` (`githubModule()`'s App), asked on each lookup. The provider is `CHAMVI_SANDBOX_PROVIDER`, else `options.provider`, else `local`, read from `options.env ?? process.env` when the factory is called; `CHAMVI_SANDBOX_NAMESPACE`, `CHAMVI_SANDBOX_IMAGE` and `CHAMVI_DEPLOYMENT` (the manager's `deployment`) win over the options too. `isSettled` defaults to the engine's `getRun`: a settled run's workspaces are collected, and a missing run's only with a named deployment (`CHAMVI_DEPLOYMENT` or `deployment`), since in `default` an unknown run may be another app's on the same host; give each app sharing a host its own name. In start and job mode `setup` imports the provider package (`@chamvi/sandbox-local`, `@chamvi/sandbox-docker` or `@chamvi/sandbox-k8s`, installed beside `@chamvi/sandbox` and resolved from there; they are no declared peers, since every provider depends on `@chamvi/sandbox` and release-please refuses the cycle; a missing one throws `InvalidAgentDefinitionError` naming it, and under a strict layout that hides undeclared packages (Yarn PnP, pnpm with `hoist=false`) pass a built provider as `options.provider`), and the lifecycle hooks attach the manager to the engine, provide it (`engineCreated`; in start mode also starting the garbage collection every `gcIntervalMs` on the engine's clock) and close it after the engine drained (the collection timer stopped first); `CHAMVI_SANDBOX_IMAGES` (a comma list of exact image references; an entry that is none is an `InvalidAgentDefinitionError` naming the variable) is the image allow-list and wins over `allowImage`; migrate mode does nothing. `@chamvi/app` is an optional peer: the main entry never imports it.

<<< ../../../sandbox/src/module/types.ts#public{ts}

## @chamvi/sandbox-local

```ts
function createLocalSandbox(options?: LocalSandboxOptions): ISandboxProvider; // name 'local'
```

No isolation: development and tests only. Workspaces are folders under `root` (default `<os tmpdir>/chamvi-workspaces`); of the limits only `maxLifetimeMs` applies. The cache variables point into `<root>/.cache` (`cache: false` sets none). `find` rebuilds a workspace from its `workspace.json`, so a restarted process reaches it; the record holds the create's `env` on disk, so the folder is `0700` and the record `0600`.

<<< ../../../sandbox-local/src/provider/types.ts{ts}

## @chamvi/sandbox-docker

```ts
function createDockerSandbox(options?: DockerSandboxOptions): ISandboxProvider; // name 'docker'

const DEFAULT_NETWORK: 'bridge';
const CONTAINER_NAME_PREFIX: 'chamvi-ws-';
const DEFAULT_USER: '0:0';
```

One container per workspace (`sh -c` sleeping until `expiresAt`, also after a restart, under docker-init, `Init: true`, which reaps orphans for any image, with the image's entrypoint replaced: it stops itself at `expiresAt`), removed with its volume on dispose or by the garbage collection. Root with a writable root and `ROOT_CAPABILITIES` by default; `{ user: '1000:1000', readOnlyRoot: true }` is the hardened mode. `/cache` is an anonymous volume per workspace, or with `cache: { volume }` that named volume, shared by every workspace using it (a trust boundary). `pull` applies to every image, also one a run asked for. `find` lists a run's containers by label and starts a stopped one again. Creating the provider contacts nothing.

<<< ../../../sandbox-docker/src/provider/types.ts{ts}

## @chamvi/sandbox-k8s

```ts
function createKubernetesSandbox(options: KubernetesSandboxOptions): ISandboxProvider; // name 'k8s'
function createPodClient(input: CreatePodClientInput): IPodClient;

const CONTAINER_NAME: 'sandbox';
const POD_NAME_PREFIX: 'chamvi-ws-';
const START_TIMEOUT_MS: 120_000;
const POLL_MS: 1_000;
const FATAL_WAITING_REASONS: readonly string[];
```

One pod per workspace, sleeping for its lifetime with that `activeDeadlineSeconds` (the image's entrypoint replaced), so it ends itself at `expiresAt`; `imagePullPolicy` applies to every image; `find` lists a run's running pods by label. Root with a writable root and `ROOT_CAPABILITIES` by default (Pod Security `baseline`); `{ user: { uid: 1000, gid: 1000 }, readOnlyRoot: true }` is the hardened mode (`restricted`). `/cache` is the claim of `cache.claimName` or an emptyDir. The Role needs `pods` `create`, `get`, `list`, `delete` and `pods/exec` `get` and `create` in the sandbox namespace. See [Kubernetes & Flux](/deployment/kubernetes#sandboxes-in-the-cluster).

<<< ../../../sandbox-k8s/src/provider/types.ts{ts}

<<< ../../../sandbox-k8s/src/client/types.ts{ts}

### Bash-first migration

Remove `credentialMode`, its `CredentialMode` type and `CHAMVI_GIT_CREDENTIAL_MODE`. Workspace-installed credentials are the only mode; a set `CHAMVI_GIT_CREDENTIAL_MODE` or a `credentialMode` option is refused with `InvalidAgentDefinitionError` instead of being ignored (a former `tools` mode would otherwise hand `bash` the write token). The structured Git tools, their result types and `PushPolicy` remain available. Push checks govern `git_push` only; sandbox code with another execution path can bypass them.

### Structured Git tools and policy scope

`manager.tools()` includes `git_fetch`, `git_pull` and `git_push` without granting a bash tool. They retain structured results, per-target credential lookup, force-with-lease, branch checks and the optional durable approval flow through `push: { mode: 'approve', channel?, allowBranch?, allowForce? }`. The push policy applies only to `git_push`: bash with write credentials can bypass it. Separately, fetch/pull and push taint the run before exposing their results, including remote hook output from push. Push is always guarded in tainted runs; fetch/pull are classified outbound when their normalized target differs from the workspace's configured origin. Tainted runs therefore need approval (or are denied) before contacting a non-origin target. Origin requests remain exempt. This is not general SSRF prevention; constrain allowed repositories and network access separately. Disabling bash narrows the offered capabilities, but writable Git configuration, hooks and other indirect execution still require a threat model; the tools are not a credential-secrecy boundary. Enforce hard restrictions through token scope and forge rules.
