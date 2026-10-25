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
```

Throws `InvalidAgentDefinitionError` for a provider without `create`, `find` and `collectGarbage`, an empty `image`, invalid `env` or `limits`, a `deployment` that is no label value, an `allowRepo`, `isSettled` or `onError` that is no function, a `maxWorkspacesPerRun` below 1 or a negative `gcIntervalMs`.

On a miss (`get` without a held workspace that fits, `acquire` of a repository it does not hold) the manager asks `provider.find(runId, { deployment })` once per run at a time and adopts what it finds, so a run reaches its workspaces after a restart or on another replica. `release(runId)` (and `attach` for a settled run) disposes the held workspaces and every one `find` reports; `close()` disposes nothing a live run holds.

<<< ../../../sandbox/src/manager/types.ts{ts}

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
function prepareWorkspace(workspace: IWorkspace, input: { repo?: string; ref?: string; signal?: AbortSignal }): Promise<{ commit?: string }>;
function readCheckoutCommit(workspace: IWorkspace, signal?: AbortSignal): Promise<string | undefined>;
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
```

`normalizeRepo`, `assertGitRef` and `resolveWorkspacePath` throw `ValidationError` (model input); `resolveLimits`, `parseCpu`, `parseMemory` and `assertSandboxEnv` throw `InvalidAgentDefinitionError` (configuration); `prepareWorkspace` throws `SandboxError` with git's stderr when a checkout step fails and records the commit as `git config chamvi.commit`, which `readCheckoutCommit` reads back.

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

The provider is `CHAMVI_SANDBOX_PROVIDER`, else `options.provider`, else `local`, read from `options.env ?? process.env` when the factory is called; `CHAMVI_SANDBOX_NAMESPACE`, `CHAMVI_SANDBOX_IMAGE` and `CHAMVI_DEPLOYMENT` (the manager's `deployment`) win over the options too. `isSettled` defaults to the engine's `getRun`: a settled run's workspaces are collected, and a missing run's only with a named deployment (`CHAMVI_DEPLOYMENT` or `deployment`), since in `default` an unknown run may be another app's on the same host; give each app sharing a host its own name. In start and job mode `setup` imports the provider package (`@chamvi/sandbox-local`, `@chamvi/sandbox-docker` or `@chamvi/sandbox-k8s`, installed beside `@chamvi/sandbox` and resolved from there; they are no declared peers, since every provider depends on `@chamvi/sandbox` and release-please refuses the cycle; a missing one throws `InvalidAgentDefinitionError` naming it, and under a strict layout that hides undeclared packages (Yarn PnP, pnpm with `hoist=false`) pass a built provider as `options.provider`), and the lifecycle hooks attach the manager to the engine, provide it (`engineCreated`) and close it after the engine drained; migrate mode does nothing. `@chamvi/app` is an optional peer: the main entry never imports it.

<<< ../../../sandbox/src/module/types.ts#public{ts}

## @chamvi/sandbox-local

```ts
function createLocalSandbox(options?: LocalSandboxOptions): ISandboxProvider; // name 'local'
```

No isolation: development and tests only. Workspaces are folders under `root` (default `<os tmpdir>/chamvi-workspaces`); of the limits only `maxLifetimeMs` applies. `find` rebuilds a workspace from its `workspace.json`, so a restarted process reaches it.

<<< ../../../sandbox-local/src/provider/types.ts{ts}

## @chamvi/sandbox-docker

```ts
function createDockerSandbox(options?: DockerSandboxOptions): ISandboxProvider; // name 'docker'

const DEFAULT_NETWORK: 'bridge';
const CONTAINER_NAME_PREFIX: 'chamvi-ws-';
const SANDBOX_USER: '1000:1000';
```

One container per workspace (`sleep infinity`: its lifetime follows the run), removed with its volume on dispose or by the garbage collection. `find` lists a run's containers by label and starts a stopped one again. Creating the provider contacts nothing.

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

One pod per workspace, without `activeDeadlineSeconds` (its lifetime follows the run); `find` lists a run's running pods by label. The Role needs `pods` `create`, `get`, `list`, `delete` and `pods/exec` `get` and `create` in the sandbox namespace. See [Kubernetes & Flux](/deployment/kubernetes#sandboxes-in-the-cluster).

<<< ../../../sandbox-k8s/src/provider/types.ts{ts}

<<< ../../../sandbox-k8s/src/client/types.ts{ts}
