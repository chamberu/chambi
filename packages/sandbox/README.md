<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/sandbox" width="128" height="128" />
</p>

<h1 align="center">@chamvi/sandbox</h1>

<p align="center">
    <b>Disposable workspaces for chamvi agents.</b><br>
    The sandbox contracts every provider implements, the rules they share (paths, repositories, output caps, limits),<br>
    and run-scoped workspaces the model creates with a tool call and chamvi disposes when the run settles.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/sandbox"><img src="https://img.shields.io/npm/v/@chamvi/sandbox" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/sandbox/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/sandbox" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Providers](#providers)
- [Usage](#usage)
- [Workspace tools](#workspace-tools)
- [Lifecycle](#lifecycle)
- [Workspaces](#workspaces)
- [Repositories and refs](#repositories-and-refs)
- [Limits and environment](#limits-and-environment)
- [Security](#security)
- [Writing a provider](#writing-a-provider)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/sandbox @chamvi/core ai --save
```

ESM only, Node.js `>=22`. `@chamvi/core` and `ai` are peer dependencies. Install a provider next to it.

## Providers

| Package | Where commands run | Isolation |
|---|---|---|
| [`@chamvi/sandbox-local`](../sandbox-local) | A temporary directory on the host, as the host user | None: development and tests only |
| [`@chamvi/sandbox-docker`](../sandbox-docker) | One container per workspace | uid 1000, read-only root, no capabilities, `no-new-privileges`, cpu, memory and pid limits |
| [`@chamvi/sandbox-k8s`](../sandbox-k8s) | One pod per workspace | Non-root, read-only root, no capabilities, no service account token, resource limits |

The coding tools (`read_file`, `edit_file`, `bash`, `git_diff`, ...) live in [`@chamvi/coding`](../coding).

## Usage

`createWorkspaceManager()` holds a run's workspaces; `attach(engine)` disposes them once the run completed, failed or was cancelled:

```typescript
import type { Engine } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspaceManager } from '@chamvi/sandbox';

export function createWorkspaces(
    provider: ISandboxProvider,
    engine: Pick<Engine, 'on'>,
): IWorkspaceManager {
    const workspaces = createWorkspaceManager({
        provider,
        // at most two workspaces per run, each gone after 15 minutes
        maxWorkspacesPerRun: 2,
        limits: { maxLifetimeMs: 15 * 60_000 },
        // only repositories of your own organisation
        allowRepo: (url) => url.startsWith('https://github.com/acme/'),
    });

    // dispose a run's workspaces once it completed, failed or was cancelled
    workspaces.attach(engine);
    return workspaces;
}
```

Give the agent `workspaces.tools()` (and usually `codingTools(workspaces)` from `@chamvi/coding`). At shutdown, close the manager **after** the engine drained. It disposes nothing a live run holds: a run waiting for an approval or interrupted by the drain finds its workspaces again after the restart.

```ts
await engine.drain();
await workspaces.close();
```

`close()` aborts the creates still in flight (disposing what they made) and waits for them and for every disposal already started, also those a run that settled during `engine.drain()` started, at most `timeoutMs` (`CLOSE_TIMEOUT_MS`, 30 s): then it resolves and reports what is still being disposed to `onError`, so a hanging Docker daemon or Kubernetes API cannot stall the shutdown. `release(runId)` waits for the run's creates in flight the same way.

## Workspace tools

`workspaces.tools()` is a plain AI SDK `ToolSet`, scoped to the calling run (`context.run.runId`):

| Tool | Input | Result |
|---|---|---|
| `create_workspace` | `{ repo?, ref? }` | `{ workspace, root: '/workspace', repo, ref, commit, expiresAt, reused }` |
| `dispose_workspace` | `{ workspace? }` | `{ workspace, disposed: true }` |

- `create_workspace` with a `repo` checks it out shallowly at `ref` (default: the default branch); without one the workspace is an empty `git init`-ed directory (for "install the published package and run a repro script"). Calling it again for the same repository returns the same workspace with `reused: true`; another `ref` of a held repository is an error telling the model to dispose it first.
- A run holds at most `maxWorkspacesPerRun` (3) workspaces at once.
- A workspace id of another run is "not found", never that workspace: ids land in stored steps that other readers may see.
- Neither tool is an effect tool: a workspace can be removed, expire or be collected, while an effect record would survive in the store and skip the redone step on a fresh workspace.

## Lifecycle

A workspace is keyed by `(run, repository)`. Its lifetime follows the run (containers sleep forever, pods have no deadline), and it lives until the first of:

- the run settles (`completed`, `failed`, `cancelled`; through `attach(engine)`, which also disposes the run's workspaces another process created: through `provider.find` for a run this process holds or looks up, else, with `isSettled`, through a garbage collection it starts (at most one per `gcIntervalMs`), so a settled run that never used a workspace costs no container or pod list); it is kept while the run is `waiting` for an approval or `interrupted`,
- `dispose_workspace` or `manager.release(runId, id?)`,
- its hard cap (`limits.maxLifetimeMs`, default 7 days from its creation, never renewed), checked on every `get` and `acquire`,
- garbage collection: `acquire` (and, with `isSettled`, a settled run `attach` sees that this process never touched) runs `manager.collectGarbage()` at most every `gcIntervalMs` (10 minutes), which disposes the manager's expired workspaces, with `isSettled` releases the runs that settled, and then calls the provider's `collectGarbage({ deployment, isSettled })` (expired containers, pods or directories, and with `isSettled` those of settled or missing runs, also left behind by crashed processes). Call it from your own timer too if runs are rare.

**Finding workspaces again**: on a miss (`get` without a held workspace that fits, `acquire` of a repository it does not hold) the manager asks `provider.find(runId, { deployment })` (one lookup per run at a time) and adopts what it finds, so a run reaches its workspaces after an approval pause, a restart or on another replica of the same Docker host or cluster. `deployment` (default `'default'`) keeps deployments that share a host or namespace apart: `find` and the garbage collection only see their own. `isSettled(runId)` tells the garbage collection which runs settled (`sandboxModule()` answers it through the engine: a settled run, and a run the store does not hold only with a named deployment, since in `default` it may be another app's on the same host). Give each app sharing a host its own deployment; two apps with the same name remove each other's workspaces.

## Workspaces

```ts
interface IWorkspace {
    readonly id: string;              // randomUUID()
    readonly info: WorkspaceInfo;     // runId, provider, repo, ref, commit, image, createdAt, expiresAt
    readonly disposed: boolean;       // disposed, or found gone
    exec(argv: readonly string[], options?: ExecOptions): Promise<ExecResult>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    dispose(): Promise<void>;
}
```

- **argv only.** `exec` never takes a shell string. The only shell is the coding `bash` tool, which runs `['sh', '-c', command]` inside the workspace.
- **Paths** are relative to the workspace root or start with `/workspace/`; every provider shows the model `/workspace`. An empty path, a NUL byte, any other absolute path or one that leaves the root (`../x`, `/workspace/../etc`) is a `ValidationError` before any filesystem or exec call (`resolveWorkspacePath`).
- **Output** is capped at `OUTPUT_MAX_BYTES` (64 KiB) per stream with `stdoutTruncated` / `stderrTruncated`; the reader keeps draining past the cap, so a flood never blocks the child or the host's memory.
- **Timeouts**: `timeoutMs` defaults to `EXEC_TIMEOUT_MS` (5 minutes), at most `EXEC_TIMEOUT_MAX_MS` (30 minutes) and never past the workspace's expiry. A timeout is a result (`timedOut: true`), not an error; the whole process group goes, backgrounded grandchildren included. A command that exits on its own returns with its exit code and its output about 2 s after its exit even when a background job it started (`node server.js &`) still holds its output; the job keeps running until the workspace is disposed. A command that cannot start exits 127.
- **cwd** must name a directory in the workspace; another one rejects with `SandboxError('cwd /workspace/<path> is no directory in the workspace.')` on every provider.
- **Files**: `readFile` and `writeFile` take UTF-8 text of at most `FILE_MAX_BYTES` (1 MiB). `readFile` of a file that is not valid UTF-8 (Latin-1, binary) throws `SandboxError` instead of replacing bytes, so `edit_file` never rewrites bytes it did not edit.
- **Abort**: `signal` stops waiting on the command. Local kills the process group; Docker and Kubernetes detach, and the command runs on until its `timeout` wrapper fires or the workspace is disposed (which every settled run does).
- **Dispose** is idempotent; an exec in flight rejects with `SandboxError('workspace disposed')`, and every call after it rejects.
- **Gone**: a workspace whose container stopped or was removed (a `docker kill`, a daemon restart without live-restore), whose pod failed, was evicted or deleted, or whose local directory was removed, reads as `disposed` once a call found it so, and that call rejects with "workspace ... is gone; call create_workspace for a new one". The manager then forgets it without disposing it (a dispose would remove a stopped container with its volume) and asks `provider.find` on the next `get` or `acquire`: a stopped Docker container of an unexpired workspace is started again and comes back with its work, also in the process that held it (a daemon restart while the run waits for an approval). What `find` does not report any more (a removed container, a failed or deleted pod, a removed directory) stays gone: `get` repeats the gone message once, and `create_workspace` creates a new one (`reused: false`). A gone local workspace kills its background jobs when it finds its directory removed.

Failures of the sandbox itself (a create, start or checkout that failed, a missing or oversized file, an unknown, expired or disposed workspace, a provider API error) are core `SandboxError`s (`sandbox_error`): a tool error the model sees, never a failed run.

## Repositories and refs

`normalizeRepo()` accepts:

- `owner/name`, which becomes `https://github.com/owner/name.git`,
- an `https:` URL without credentials, query or fragment,
- `file:///absolute/path` only with `allowFileRepos: true` (local development and tests).

Everything else (`git@github.com:o/r.git`, `ext::sh -c id`, `https://user:token@...`, `file:` without the flag) is a `ValidationError` whose message never echoes the input, since it may carry a token. `allowRepo(url)` narrows the accepted URLs further.

A ref matches `^[A-Za-z0-9][A-Za-z0-9._/+-]{0,254}$` without `..`, `//`, `@{`, a trailing `/` or `.lock` (`assertGitRef`), so it can never read as a git option or a revision range.

The checkout runs inside the workspace through its own `exec`, the same commands on every provider: `git init -q .`, `git remote add origin <url>`, `git -c credential.helper= fetch -q --depth 1 origin <ref or HEAD>`, `git -c advice.detachedHead=false checkout -q FETCH_HEAD`, `git rev-parse HEAD` (`info.commit`). A failed step disposes the workspace and throws a `SandboxError` with git's stderr (first 2000 characters).

## Limits and environment

| Limit | Default | Local | Docker | Kubernetes |
|---|---|---|---|---|
| `cpu` | `'1'` | not enforced | `NanoCpus` | requests and limits |
| `memory` | `'2Gi'` | not enforced | `Memory` (no swap on top) | requests and limits |
| `storage` | `'4Gi'` | not enforced | not enforced (a default volume has no size) | emptyDir `sizeLimit`, `ephemeral-storage` |
| `pids` | `512` | not enforced | `PidsLimit` | the kubelet's `podPidsLimit` |
| `maxLifetimeMs` | `604_800_000` (7 days) | expiry | expiry (removed by the garbage collection) | expiry (removed by the garbage collection) |

Quantities use Kubernetes notation (`'500m'`, `'1.5'`, `'512Mi'`, `'2G'`). `/tmp` is a 512 MiB tmpfs in containers and pods (`TMP_SIZE`).

No host environment reaches a workspace. Containers and pods get `SANDBOX_ENV` (`HOME=/tmp`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `safe.directory=/workspace`, `NPM_CONFIG_UPDATE_NOTIFIER=false`, `CI=true`) plus the configured `env`; local gets the host `PATH`, its own `HOME` and `TMPDIR` and the same git settings. `env` keys match `^[A-Za-z_][A-Za-z0-9_]*$`, values carry no NUL. Never put secrets there: whatever runs in the workspace can read them.

## Security

- **Untrusted code**: the model decides what runs, and an issue body or a README it reads can steer it (prompt injection). Run untrusted repositories on Docker or Kubernetes, never local, and put `bash` behind an approval where a human should see each command: a `beforeToolExecution` hook on the agent that calls `approve()` for `toolName === 'bash'` (see [`@chamvi/coding`](../coding#usage)).
- **No credentials**: repository URLs with credentials are refused, `credential.helper` is reset for the fetch, and no token, service account or host variable enters a workspace. Private repositories are not supported yet.
- **Not a network boundary**: a container sandbox stops code from touching the host, not from reaching the network. On a Docker `bridge` network a workspace reaches the host gateway (the chamvi API, Postgres), other containers and cloud metadata (`169.254.169.254`); on Kubernetes every cluster service by DNS. Add an egress firewall or a NetworkPolicy (the Helm chart's is planned), and narrow `allowRepo`.

## Writing a provider

A provider implements `ISandboxProvider` (`name`, `create(options)`, `find(runId, { deployment, signal })`, `collectGarbage({ deployment, isSettled })`). Put `workspaceLabels()` and `workspaceMetadata()` on what you create and rebuild the info in `find` with `readWorkspaceInfo()` and `readCheckoutCommit()`; `createSettledCheck()` asks `isSettled` once per run in a pass. A container-like provider only needs an `IExecTransport` (`exec(argv, { stdin, stdout, stderr, signal })` that streams the output into the given sinks and resolves `{ exitCode }`, `remove()` and optionally `alive(signal)`, asked after a failed exec: `false` marks the workspace gone): `createRemoteWorkspace({ id, info, transport, clock })` adds the rest. It runs argv through `sh -c` with the working directory and the `timeout` wrapper and has the script report the exit status on stderr, so an exec returns 2 s after the command exited even when a background job holds the output; it adds the client-side guard, path checks, output caps, file reads and writes and dispose semantics. After creating, call `prepareWorkspace(workspace, { repo, ref, signal })` and set `info.commit`. `describeWorkspaceContract()` from `@chamvi/test-kit` is the Vitest suite every provider must pass.

## Context

`provideSandboxContext(engine, manager)` provides the manager on the engine; a tools factory reads it with `injectSandboxContext(ctx)` and builds the workspace and coding tools per execution:

```ts
import { injectSandboxContext, provideSandboxContext } from '@chamvi/sandbox';
import { codingTools } from '@chamvi/coding';

const coder = defineAgent({
    name: 'coder',
    model,
    instructions: 'Fix the failing test.',
    tools: (ctx) => {
        const manager = injectSandboxContext(ctx);
        return { ...manager.tools(), ...codingTools(manager) };
    },
});

provideSandboxContext(engine, workspaces); // once, after new Engine()
```

A missing manager throws `ContextNotProvidedError` naming `sandbox` (in the factory the run fails before any model call).

## With @chamvi/app

`sandboxModule()` from `@chamvi/sandbox/module` picks the provider from `CHAMVI_SANDBOX_PROVIDER` (`local`, `docker`, `kubernetes`), else `options.provider`, else `local`, builds the manager when it is called (`.manager` at once), imports the provider package on start (`@chamvi/sandbox-local`, `@chamvi/sandbox-docker` or `@chamvi/sandbox-k8s`; install the one you use beside `@chamvi/sandbox`, it is no declared peer; under Yarn PnP or pnpm with `hoist=false`, where `@chamvi/sandbox` cannot resolve an undeclared package, pass a built provider instead: `sandboxModule({ provider: createDockerSandbox() })`), attaches the manager, provides it on the engine and closes it after the engine drained. `@chamvi/app` is an optional peer; the main entry never imports it.

```ts
import { createApp } from '@chamvi/app';
import { sandboxModule } from '@chamvi/sandbox/module';

export default createApp({ agents: [coder], modules: [sandboxModule({ provider: 'docker' })] });
```

## Options

`createWorkspaceManager(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `ISandboxProvider` | required | Creates the workspaces |
| `image` | `string` | the provider's | Passed to every `create` |
| `env` | `Record<string, string>` | none | Passed to every `create` |
| `limits` | `SandboxLimits` | the provider's | Passed to every `create` |
| `allowFileRepos` | `boolean` | `false` | Accept `file:///absolute/path` repositories |
| `allowRepo` | `(url) => boolean` | every https URL | Narrows the accepted repositories (gets the normalized URL) |
| `maxWorkspacesPerRun` | `number` | `3` | Workspaces one run may hold at once |
| `gcIntervalMs` | `number` | `600_000` | Minimum interval between the collections `acquire` starts; `0` disables them |
| `clock` | `IClock` | `systemClock` | Expiry and the collection interval |
| `onError` | `(error) => void` | `console.error` | Background failures (disposal, garbage collection) |

Misconfiguration throws core `InvalidAgentDefinitionError`.

## API

| Export | Kind | Purpose |
|---|---|---|
| `createWorkspaceManager` | function | Run-scoped workspaces and the workspace tools |
| `provideSandboxContext`, `injectSandboxContext` | function | Provide the manager on the engine, read it from a `ToolContext` |
| `createRemoteWorkspace` | function | An `IWorkspace` over an `IExecTransport` |
| `prepareWorkspace` | function | The checkout inside a workspace |
| `normalizeRepo`, `assertGitRef` | function | Repository and ref rules |
| `resolveWorkspacePath` | function | Path rule |
| `resolveLimits`, `parseCpu`, `parseMemory`, `assertSandboxEnv` | function | Limits and environment rules |
| `createOutputCollector` | function | A capped output stream collector |
| `WORKSPACE_ROOT`, `OUTPUT_MAX_BYTES`, `FILE_MAX_BYTES`, `EXEC_TIMEOUT_MS`, `EXEC_TIMEOUT_MAX_MS`, `SANDBOX_ENV` | constant | Workspace rules |
| `DEFAULT_LIMITS`, `DEFAULT_SANDBOX_IMAGE`, `TMP_SIZE`, `SANDBOX_LABELS`, `RUN_LABEL`, `WORKSPACE_LABEL`, `EXPIRES_AT_KEY` | constant | Provider defaults and labels |
| `MAX_WORKSPACES_PER_RUN`, `GC_INTERVAL_MS`, `CLOSE_TIMEOUT_MS` | constant | Manager defaults |
| `TIMEOUT_KILL_AFTER_SECONDS`, `EXEC_GRACE_MS`, `ALIVE_PROBE_TIMEOUT_MS` | constant | Remote timeout handling and the liveness probe bound |

Types: `IWorkspace`, `WorkspaceInfo`, `ExecOptions`, `ExecResult`, `ISandboxProvider`, `WorkspaceCreateOptions`, `SandboxLimits`, `IExecTransport`, `TransportExecOptions`, `TransportExecResult`, `RemoteWorkspaceInput`, `IWorkspaceManager`, `WorkspaceManagerOptions`, `AcquireInput`, `AcquireResult`, `CloseOptions`, `WorkspaceToolResult`, `DisposeWorkspaceResult`, `IOutputCollector`, `NormalizeRepoOptions`.

`@chamvi/sandbox/module`: `sandboxModule`, `SandboxModule`, `SANDBOX_MODULE_NAME`, `SANDBOX_PROVIDER_NAMES`, types `SandboxModuleOptions`, `SandboxProviderName`.

## License

Published under [Apache License 2.0](./LICENSE).
