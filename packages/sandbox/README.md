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
| [`@chamvi/sandbox-docker`](../sandbox-docker) | One container per workspace | Root inside with a writable root and only the package-manager capabilities, `no-new-privileges`, cpu, memory and pid limits; a hardened mode (uid 1000, read-only root, no capability) |
| [`@chamvi/sandbox-k8s`](../sandbox-k8s) | One pod per workspace | The same, plus no service account token; the hardened mode fits Pod Security `restricted` |

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

Give the agent `workspaces.tools()` (and usually `codingTools(workspaces)` from `@chamvi/coding`). At shutdown, close the manager **after** the engine drained. It disposes nothing a live run holds: a run waiting for an approval or interrupted by the drain finds its workspaces again after the restart. With a store no run resumes from (a `MemoryStore`) call `close({ dispose: true })`, which disposes those too; `sandboxModule()` does that by itself.

```ts
await engine.drain();
await workspaces.close();
```

`close()` aborts the creates still in flight (disposing what they made) and waits for them and for every disposal already started, also those a run that settled during `engine.drain()` started, at most `timeoutMs` (`CLOSE_TIMEOUT_MS`, 30 s): then it resolves and reports what is still being disposed to `onError`, so a hanging Docker daemon or Kubernetes API cannot stall the shutdown. `release(runId)` waits for the run's creates in flight the same way.

## Workspace tools

`workspaces.tools()` is a plain AI SDK `ToolSet`, scoped to the calling run (`context.run.runId`):

| Tool | Input | Result |
|---|---|---|
| `create_workspace` | `{ repo?, ref?, image? }` (`image` only with an allow-list, never on the local provider) | `{ workspace, root: '/workspace', repo, ref, commit, defaultBranch, image, expiresAt, reused }` |
| `dispose_workspace` | `{ workspace? }` | `{ workspace, disposed: true }` |
| `git_fetch` | `{ remote?, refspec?, workspace? }` | `{ workspace, remote, refspec, exitCode, stdout, stderr, timedOut }` |
| `git_pull` | `{ remote?, branch?, rebase?, workspace? }` | the same plus `{ branch, rebase, step }` |
| `git_push` | `{ remote?, branch?, force?, setUpstream?, workspace? }` | the same plus `{ branch, commit, pushed, forced }` |

- `create_workspace` with a `repo` checks it out with its full history at `ref` (default: the default branch), a branch tracking `origin/<ref>` and the default branch fetched next to it (`defaultBranch` in the result); without one the workspace is an empty `git init`-ed directory (for "install the published package and run a repro script"). Calling it again for the same repository returns the same workspace with `reused: true`; another `ref` or `image` of a held repository is an error telling the model to dispose it first.
- `image` picks a container image (`python:3.13`, `rust:1`) and exists only when the manager has an allow-list (`allowImage(image)`; in `sandboxModule()` also `CHAMVI_SANDBOX_IMAGES`, a comma list of exact references, which wins) and never on the local provider, which runs no images; a requested image without one, a refused or a malformed reference is a `ValidationError`, before any create. The image needs `sh`, `git` and a GNU `timeout` that takes `-k`; the provider probes them before the checkout and names what is missing. Without it the workspace runs the manager's `image`, else the provider's (`sandbox-dev`, where `mise use -g node@22` installs any toolchain).
- A run holds at most `maxWorkspacesPerRun` (3) workspaces at once.
- A workspace id of another run is "not found", never that workspace: ids land in stored steps that other readers may see.
- `git_fetch`, `git_pull` and `git_push` authenticate with the run's [git credentials](#git-credentials) and pass the repository URL on the command line, never trusting `remote.*.url`; `remote` names another repository (a fork), checked like `repo`. A rejected push or a merge conflict comes back in the result, not as an error.
- No tool is an effect tool: a workspace can be removed, expire or be collected, while an effect record would survive in the store and skip the redone step on a fresh workspace.

## Lifecycle

A workspace is keyed by `(run, repository)`. Its lifetime follows the run up to a hard cap: a container sleeps until `expiresAt` (an absolute deadline, also after `find` starts it again) and a pod the same way (`SLEEP_UNTIL_SCRIPT`, with `lifetimeSeconds(info)` as its `activeDeadlineSeconds`), so it stops itself at `expiresAt` even when nothing collects it, and it lives until the first of:

- the run settles (`completed`, `failed`, `cancelled`; through `attach(engine)`, which also disposes the run's workspaces another process created: through `provider.find` for a run this process holds or looks up, else, with `isSettled`, through a garbage collection it starts (at most one per `gcIntervalMs`), so a settled run that never used a workspace costs no container or pod list); it is kept while the run is `waiting` for an approval or `interrupted`,
- `dispose_workspace` or `manager.release(runId, id?)`,
- its hard cap (`limits.maxLifetimeMs`, default 7 days from its creation, never renewed), checked on every `get` and `acquire`,
- garbage collection: `acquire` (and, with `isSettled`, a settled run `attach` sees that this process never touched) runs `manager.collectGarbage()` at most every `gcIntervalMs` (10 minutes), which disposes the manager's expired workspaces, with `isSettled` releases the runs that settled, and then calls the provider's `collectGarbage({ deployment, isSettled })` (expired containers, pods or directories, and with `isSettled` those of settled or missing runs, also left behind by crashed processes). `sandboxModule()` also runs it on a timer in start mode (every `gcIntervalMs` on the engine's clock, stopped once the engine drained); a manager you build yourself needs your own timer if runs are rare.

**Finding workspaces again**: on a miss (`get` without a held workspace that fits, `acquire` of a repository it does not hold) the manager asks `provider.find(runId, { deployment })` (one lookup per run at a time) and adopts what it finds, so a run reaches its workspaces after an approval pause, a restart or on another replica of the same Docker host or cluster. `deployment` (default `'default'`) keeps deployments that share a host or namespace apart: `find` and the garbage collection only see their own. `isSettled(runId)` tells the garbage collection which runs settled (`sandboxModule()` answers it through the engine: a settled run, and a run the store does not hold only with a named deployment, since in `default` it may be another app's on the same host). Give each app sharing a host its own deployment; two apps with the same name remove each other's workspaces.

## Workspaces

```ts
interface IWorkspace {
    readonly id: string;              // randomUUID()
    readonly info: WorkspaceInfo;     // runId, provider, repo, ref, commit, image, createdAt, expiresAt
    readonly disposed: boolean;       // disposed, or found gone
    exec(argv: readonly string[], options?: ExecOptions): Promise<ExecResult>;
    readFile(path: string): Promise<string>;
    readBytes(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    dispose(): Promise<void>;
    redact?(text: string): string;                  // the manager's credential view only
    readFileRaw?(path: string): Promise<string>;    // the same view: unredacted, for tools that write the text back
    redactedSpans?(text: string): Array<{ start: number; end: number }>; // the same view: what redact replaces
}
```

- **argv only.** `exec` never takes a shell string. The only shells are the coding tools' `sh -c` scripts inside the workspace, which take the command as an argument.
- **Paths** are relative to the workspace root or start with `/workspace/`; every provider shows the model `/workspace`. An empty path, a NUL byte, any other absolute path or one that leaves the root (`../x`, `/workspace/../etc`) is a `ValidationError` before any filesystem or exec call (`resolveWorkspacePath`).
- **Output** is capped at `OUTPUT_MAX_BYTES` (64 KiB) per stream with `stdoutTruncated` / `stderrTruncated`; the reader keeps draining past the cap, so a flood never blocks the child or the host's memory.
- **Timeouts**: `timeoutMs` defaults to `EXEC_TIMEOUT_MS` (5 minutes), at most `EXEC_TIMEOUT_MAX_MS` (30 minutes) and never past the workspace's expiry. A timeout is a result (`timedOut: true`), not an error; the whole process group goes, backgrounded grandchildren included. A command that exits on its own returns with its exit code and its output about 2 s after its exit even when a background job it started (`node server.js &`) still holds its output; the job keeps running until the workspace is disposed. A command that cannot start exits 127.
- **cwd** must name a directory in the workspace; another one rejects with `SandboxError('cwd /workspace/<path> is no directory in the workspace.')` on every provider.
- **Files** have at most `FILE_MAX_BYTES` (16 MiB). `readBytes` returns the raw bytes, `writeFile` takes UTF-8 text or bytes. `readFile` of a file that is not valid UTF-8 (Latin-1, binary) throws `SandboxError` instead of replacing bytes, so `edit_file` never rewrites bytes it did not edit.
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

The checkout runs inside the workspace through its own `exec`, the same commands on every provider: `git init -q .`, `git remote add origin <url>`, `git ls-remote --symref <url> HEAD` (the default branch, `info.defaultBranch`), `git fetch -q [--depth <n>] origin <ref or the default branch> [<default branch>]` (full history unless the manager's `depth` is set), `git checkout -q -B <ref> --track origin/<ref>` for a branch or a detached `FETCH_HEAD` for a tag or commit, `git rev-parse HEAD` (`info.commit`), then `git config chamvi.defaultBranch <branch>` and, last, `git config chamvi.checkout <commit or none>`, so a workspace whose create died during the checkout is never found again. The remote calls reset every credential helper and disable hooks (`-c credential.helper= -c core.hooksPath=/dev/null`); with a credential they run through the one-shot helper described under [Git credentials](#git-credentials). A failed step disposes the workspace and throws a `SandboxError` with git's stderr (first 2000 characters).

## Git credentials

Private repositories and pushes take `credentials` on the manager, one source or a list (the first answer wins, none is anonymous):

```ts
import { createWorkspaceManager, staticGitCredentials } from '@chamvi/sandbox';

const workspaces = createWorkspaceManager({
    provider,
    credentials: staticGitCredentials([{ host: 'github.com', path: 'acme', token: process.env.GITHUB_TOKEN! }]),
    author: { name: 'acme-bot', email: 'bot@acme.dev' },
    push: { allowForce: true },
});
```

- `staticGitCredentials([{ host, path?, username?, token }])`: GitHub (`x-access-token`), GitLab (`oauth2`) or any https host; `path` narrows to an owner or repository (case-insensitive), the longest match wins. `githubAppCredentials(app)` from `@chamvi/github` issues repository-scoped App tokens.
- `credentialMode: 'workspace'` (default): a credential helper and a 0600 file in the workspace's `$HOME/.chamvi/`, refreshed before a command once a token expires within ten minutes, so plain git in `bash` works; every result, file read and error the manager hands out has the tokens this process issued replaced by `[redacted]` (each until `REDACT_GRACE_MS`, one hour, after it expired; the edit tools read the raw text through `readFileRaw`; they match oldString against the redacted text the model read (`redactedSpans`), refuse an edit that touches a `[redacted]` span and put every untouched token back byte for byte, so an oldString can neither probe a token nor write `[redacted]` back). The credentials file of a workspace found again is never read back (it is model-writable): the first install overwrites it. The token in the workspace is reachable by `bash`, so its scope and the forge's branch protection are the real controls. `'tools'`: no credential in the workspace (a file an earlier workspace-mode process left in a workspace found again is removed before its first exec), only the checkout and the git tools authenticate, each through a one-shot helper reading the token from stdin.
- `push`: `mode` `'auto'` (default) or `'approve'` (asks through `approve()`, the run's source channel first), `allowForce` (default `false`, force is always `--force-with-lease`), `allowBranch(branch, ctx)` (default: every branch but the remote's default branch, read from the remote at push time). In `workspace` mode it binds `git_push` only, not a `git push` in `bash`.
- `depth` makes the checkout shallow; `author` sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*`.

## Limits and environment

| Limit | Default | Local | Docker | Kubernetes |
|---|---|---|---|---|
| `cpu` | `'1'` | not enforced | `NanoCpus` | requests and limits |
| `memory` | `'2Gi'` | not enforced | `Memory` (no swap on top) | requests and limits |
| `storage` | `'4Gi'` | not enforced | not enforced (a default volume has no size) | emptyDir `sizeLimit`, `ephemeral-storage` |
| `pids` | `512` | not enforced | `PidsLimit` | the kubelet's `podPidsLimit` |
| `maxLifetimeMs` | `604_800_000` (7 days) | expiry | expiry (removed by the garbage collection) | expiry (removed by the garbage collection) |

Quantities use Kubernetes notation (`'500m'`, `'1.5'`, `'512Mi'`, `'2G'`). `/tmp` is a 1 GiB tmpfs in containers and pods (`TMP_SIZE`, the providers' `tmpSize`).

No host environment reaches a workspace. Containers and pods get `SANDBOX_ENV` (`HOME=/home/sandbox`, `WORKSPACE_HOME`: a disk-backed volume of the workspace, kept across a restart, so cargo's, rustup's, Maven's and Gradle's homes and mise's global config never fill the memory-backed `/tmp`; `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `safe.directory=/workspace`, `NPM_CONFIG_UPDATE_NOTIFIER=false`, `CI=true`) and the cache variables (`CACHE_ENV`: `XDG_CACHE_HOME`, `npm_config_cache`, `PIP_CACHE_DIR`, `GOMODCACHE`, `GOCACHE`, `COMPOSER_CACHE_DIR`, all under `/cache`, a volume the provider mounts, per workspace by default; package downloads only, mise keeps its toolchains in HOME) plus the configured `env`; local gets the host `PATH`, its own `HOME` and `TMPDIR`, the same git settings and the cache variables under `<root>/.cache`. `env` keys match `^[A-Za-z_][A-Za-z0-9_]*$`, values carry no NUL. Never put secrets there: whatever runs in the workspace can read them.

## Security

- **Untrusted code**: the model decides what runs, and an issue body or a README it reads can steer it (prompt injection). Run untrusted repositories on Docker or Kubernetes, never local, and put `bash` behind an approval where a human should see each command: a `beforeToolExecution` hook on the agent that calls `approve()` for `toolName === 'bash'` (see [`@chamvi/coding`](../coding#usage)).
- **Permissive inside, strict at the edge**: Docker and Kubernetes workspaces run as root with a writable root filesystem by default, so `apt` and every package manager work; the container is the boundary (no privileged mode, only the package-manager capabilities, `no-new-privileges`, no host mount but the cache). The providers' `user` and `readOnlyRoot` restore the hardened mode.
- **Shared cache**: Docker gives each workspace an anonymous `/cache` of its own and Kubernetes an emptyDir by default. A cache is shared only when you configure one: `cache: { volume }` on Docker, a `cache: { claimName }` claim on Kubernetes, and locally `<root>/.cache` unless `cache: false`. Such a cache is a trust boundary shared by every run and agent that mounts it: a malicious package one run fetched can sit in another run's cache, so share one only between runs that may influence each other.
- **Credentials**: repository URLs with credentials are refused, every configured credential helper is reset for chamvi's git calls, and no service account or host variable enters a workspace. Tokens never reach a URL, the environment, a result or an error: in `credentialMode: 'workspace'` a short-lived one sits in a 0600 file the model can read, redacted from everything it sees; `'tools'` keeps it out of the workspace.
- **Not a network boundary**: a container sandbox stops code from touching the host, not from reaching the network. On a Docker `bridge` network a workspace reaches the host gateway (the chamvi API, Postgres), other containers and cloud metadata (`169.254.169.254`); on Kubernetes every cluster service by DNS. Add an egress firewall or a NetworkPolicy (the Helm chart's is planned), and narrow `allowRepo`.

## Writing a provider

A provider implements `ISandboxProvider` (`name`, `create(options)`, `find(runId, { deployment, signal })`, `collectGarbage({ deployment, isSettled })`). Put `workspaceLabels()` and `workspaceMetadata()` on what you create and rebuild the info in `find` with `readWorkspaceInfo()` and `readCheckout()` (skip a workspace it answers `undefined` for: its create died before the checkout finished); `createSettledCheck()` asks `isSettled` once per run in a pass. A container or pod should run `sh -c SLEEP_UNTIL_SCRIPT sh <expiresAt in epoch seconds>` with the image's entrypoint replaced, so it stops itself at `expiresAt`. A container-like provider only needs an `IExecTransport` (`exec(argv, { stdin, stdout, stderr, signal })` that streams the output into the given sinks and resolves `{ exitCode }`, `remove()` and optionally `alive(signal)`, asked after a failed exec: `false` marks the workspace gone): `createRemoteWorkspace({ id, info, transport, clock })` adds the rest. It runs argv through `sh -c` with the working directory and the `timeout` wrapper and has the script report the exit status on stderr, so an exec returns 2 s after the command exited even when a background job holds the output; it adds the client-side guard, path checks, output caps, file reads and writes and dispose semantics. After creating, call `prepareWorkspace(workspace, { repo, ref, signal })` and set `info.commit`. `describeWorkspaceContract()` from `@chamvi/test-kit` is the Vitest suite every provider must pass.

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

`sandboxModule()` from `@chamvi/sandbox/module` picks the provider from `CHAMVI_SANDBOX_PROVIDER` (`local`, `docker`, `kubernetes`), else `options.provider`, else `local`, builds the manager when it is called (`.manager` at once; git tokens from `CHAMVI_GIT_TOKENS` as JSON and the mode from `CHAMVI_GIT_CREDENTIAL_MODE`, plus the sources other modules contribute, e.g. `githubModule()`'s App), imports the provider package on start (`@chamvi/sandbox-local`, `@chamvi/sandbox-docker` or `@chamvi/sandbox-k8s`; install the one you use beside `@chamvi/sandbox`, it is no declared peer; under Yarn PnP or pnpm with `hoist=false`, where `@chamvi/sandbox` cannot resolve an undeclared package, pass a built provider instead: `sandboxModule({ provider: createDockerSandbox() })`), attaches the manager, provides it on the engine, in start mode runs the garbage collection every `gcIntervalMs`, and closes it after the engine drained. `CHAMVI_SANDBOX_IMAGES` (a comma list of exact image references) is the image allow-list of `create_workspace`, winning over `allowImage`; without either, no `image` is offered. `@chamvi/app` is an optional peer; the main entry never imports it.

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
| `allowImage` | `(image) => boolean` | none: no `image` offered | The images `create_workspace` may ask for; without it `create_workspace` has no `image` input and `acquire` refuses one. Never offered on the local provider |
| `maxWorkspacesPerRun` | `number` | `3` | Workspaces one run may hold at once |
| `gcIntervalMs` | `number` | `600_000` | Minimum interval between the collections `acquire` starts, and with `sandboxModule()` in start mode the period of its collection timer; `0` disables both |
| `credentials` | `IGitCredentials \| IGitCredentials[]` | none | Git credential sources, the first answer wins |
| `credentialMode` | `'workspace' \| 'tools'` | `'workspace'` | How a token reaches git |
| `depth` | `number` | full history | A shallow checkout |
| `author` | `{ name, email }` | none | The commit identity |
| `push` | `PushPolicy` | auto, no force, not the default branch | What `git_push` may push |
| `clock` | `IClock` | `systemClock` | Expiry, the collection interval, token refreshes |
| `onError` | `(error) => void` | `console.error` | Background failures (disposal, garbage collection, credential refreshes) |

Misconfiguration throws core `InvalidAgentDefinitionError`.

## API

| Export | Kind | Purpose |
|---|---|---|
| `createWorkspaceManager` | function | Run-scoped workspaces and the workspace tools |
| `staticGitCredentials` | function | Git credentials from tokens |
| `provideSandboxContext`, `injectSandboxContext` | function | Provide the manager on the engine, read it from a `ToolContext` |
| `createRemoteWorkspace` | function | An `IWorkspace` over an `IExecTransport` |
| `prepareWorkspace`, `readCheckout` | function | The checkout inside a workspace, its recorded commit and default branch |
| `normalizeRepo`, `assertGitRef` | function | Repository and ref rules |
| `resolveWorkspacePath` | function | Path rule |
| `resolveLimits`, `parseCpu`, `parseMemory`, `assertSandboxEnv` | function | Limits and environment rules |
| `assertImage`, `probeImage`, `cacheEnv`, `isRootUser` | function | Image reference rule, the image probe, the cache variables under a folder, the root check |
| `createOutputCollector` | function | A capped output stream collector |
| `WORKSPACE_ROOT`, `WORKSPACE_HOME`, `OUTPUT_MAX_BYTES`, `FILE_MAX_BYTES`, `EXEC_TIMEOUT_MS`, `EXEC_TIMEOUT_MAX_MS`, `SANDBOX_ENV` | constant | Workspace rules |
| `DEFAULT_LIMITS`, `DEFAULT_SANDBOX_IMAGE`, `TMP_SIZE`, `SANDBOX_LABELS`, `RUN_LABEL`, `WORKSPACE_LABEL`, `EXPIRES_AT_KEY` | constant | Provider defaults and labels |
| `MAX_WORKSPACES_PER_RUN`, `GC_INTERVAL_MS`, `CLOSE_TIMEOUT_MS`, `CREDENTIAL_INSTALL_TIMEOUT_MS`, `PUSH_LOG_MAX_COMMITS` | constant | Manager defaults |
| `REDACTED`, `CREDENTIAL_REFRESH_MS`, `CREDENTIAL_RETRY_MS`, `CREDENTIALS_FILE`, `REDACT_MIN_LENGTH`, `REDACT_GRACE_MS` | constant | Git credential handling |
| `TIMEOUT_KILL_AFTER_SECONDS`, `EXEC_GRACE_MS`, `ALIVE_PROBE_TIMEOUT_MS` | constant | Remote timeout handling and the liveness probe bound |
| `CACHE_DIR`, `CACHE_ENV`, `ROOT_CAPABILITIES`, `IMAGE_REQUIREMENTS`, `IMAGE_PROBE_TIMEOUT_MS` | constant | The cache mount and variables, the root capability set, the image probe |

Types: `IWorkspace`, `WorkspaceInfo`, `ExecOptions`, `ExecResult`, `ISandboxProvider`, `WorkspaceCreateOptions`, `SandboxLimits`, `IExecTransport`, `TransportExecOptions`, `TransportExecResult`, `RemoteWorkspaceInput`, `IWorkspaceManager`, `WorkspaceManagerOptions`, `AcquireInput`, `AcquireResult`, `CloseOptions`, `WorkspaceToolResult`, `DisposeWorkspaceResult`, `GitToolResult`, `GitFetchResult`, `GitPullResult`, `GitPushResult`, `GitAuthor`, `PushPolicy`, `IOutputCollector`, `NormalizeRepoOptions`, `CheckoutOptions`, `IGitCredentials`, `GitCredential`, `GitCredentialRequest`, `GitAccess`, `StaticGitCredential`, `CredentialMode`, `Redactor`.

`@chamvi/sandbox/module`: `sandboxModule`, `SandboxModule`, `SANDBOX_MODULE_NAME`, `SANDBOX_PROVIDER_NAMES`, types `SandboxModuleOptions`, `SandboxProviderName`.

## License

Published under [Apache License 2.0](./LICENSE).
