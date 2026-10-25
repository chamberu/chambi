# Workspaces & Coding

An agent that reproduces a bug, runs tests or fixes code needs a place to run commands. chamvi gives each run **disposable workspaces**: a directory, optionally a shallow checkout of a git repository, in which the model runs commands and edits files through tools. Workspaces come from a **sandbox provider** and are held by a **workspace manager** that disposes them when the run settles.

```bash
npm install @chamvi/sandbox @chamvi/coding @chamvi/sandbox-docker
```

## Providers

| Provider | Package | A workspace is | Isolation |
|---|---|---|---|
| local | [`@chamvi/sandbox-local`](/reference/sandbox#chamvi-sandbox-local) | a temporary directory on the host | **none**: development and tests only |
| Docker | [`@chamvi/sandbox-docker`](/reference/sandbox#chamvi-sandbox-docker) | one container | root inside with a writable root and only the package-manager capabilities, `no-new-privileges`, cpu, memory and pid limits |
| Kubernetes | [`@chamvi/sandbox-k8s`](/reference/sandbox#chamvi-sandbox-k8s) | one pod | the same, no service account token, resource limits |

All three pass the same workspace contract (`describeWorkspaceContract` from `@chamvi/test-kit`): argv-only exec, path checks, output caps, process-group kills on timeout, and dispose semantics.

<<< @/snippets/sandbox-providers.ts#docker

<<< @/snippets/sandbox-providers.ts#k8s

The container providers use `ghcr.io/chamvi/sandbox-dev:trixie` by default (Debian, git, curl, ripgrep, jq, build-essential, `tini` and [mise](https://mise.jdx.dev)), built for `linux/amd64` and `linux/arm64`. It ships no language toolchain: the model installs what the repository needs, `mise use -g node@22` or `mise install` (which reads `.tool-versions`, `mise.toml`, `.nvmrc` and `.python-version`), and system packages with `apt-get`. Pin a digest in production. See [Docker Image](/deployment/docker#sandbox-image).

### Usable inside, strict at the edge

Inside a Docker or Kubernetes workspace the model may do what a developer does on a throwaway machine: it runs as **root** with a **writable root filesystem**, so `apt-get install`, `npm install -g` and any installer work without an approval. The container is the boundary: no privileged mode, every capability dropped but `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `FSETID`, `SETUID`, `SETGID` and `KILL`, `no-new-privileges`, the cpu, memory and pid limits, and no host mount but the package cache.

Where that is too much, the providers' **hardened mode** restores a non-root user and a read-only root (no capability at all; toolchains still install into the cache through mise, `apt` does not work):

```ts
createDockerSandbox({ user: '1000:1000', readOnlyRoot: true });
createKubernetesSandbox({ namespace: 'agents-sandbox', user: { uid: 1000, gid: 1000 }, readOnlyRoot: true });
```

On Kubernetes the default needs a namespace whose Pod Security admits root pods (`baseline`); the hardened mode fits `restricted`. See [Kubernetes](/deployment/kubernetes#pod-security).

### Any image

`create_workspace({ image })` lets the model pick any image (`python:3.13`, `rust:1`, `ghcr.io/acme/builder:2`); the manager's `allowImage(image)` narrows it (default: every image), and the model never gets more cpu, memory, lifetime or workspaces than you configured. A model-chosen image is pulled when missing. It needs `sh`, `git` and a GNU `timeout` that takes `-k`: the provider probes them before the checkout and fails with a message naming what is missing (busybox images lack a `timeout -k` on old versions, `debian:*-slim` lacks git).

### The package cache

Every container and pod mounts `/cache` and sets `XDG_CACHE_HOME`, `npm_config_cache`, `PIP_CACHE_DIR`, `GOMODCACHE`, `GOCACHE`, `COMPOSER_CACHE_DIR` and `MISE_DATA_DIR` into it (local: `<root>/.cache`), so installs and toolchains are fetched once. Only caches are shared: homes that keep credentials or installed programs stay per workspace (`CARGO_HOME`, which holds `cargo login`'s `credentials.toml` and `cargo install`ed binaries, stays `$HOME/.cargo`; npm's `.npmrc` stays in `$HOME`). `HOME` is `/home/sandbox`, a disk-backed volume of the workspace (kept when a stopped container restarts, removed with the workspace), never the memory-backed `/tmp`, so cargo, rustup, Maven and Gradle homes and mise's global config and shims count neither against `tmpSize` nor the memory limit. On Docker it is one named volume per host by default (`chamvi-sandbox-cache`, and `chamvi-sandbox-cache-<user>` for a non-root `user`, since a root workspace leaves folders only root can write); on Kubernetes a ReadWriteMany claim you name (`cache: { claimName }`), else an emptyDir per pod. `/tmp` is a 1 GiB tmpfs (`tmpSize`).

::: warning A shared cache is shared trust
Workspaces of different runs and agents share the cache. A malicious package one run fetched can sit in another run's cache: npm verifies integrity hashes, pip, Go's build cache and others less. Turn sharing off per provider (`cache: false` on Docker and local, no claim on Kubernetes), or give each trust level its own volume.

chamvi's own commands never run from the cache: every workspace command starts with every `/cache` folder dropped from `PATH`, so a `git` or `timeout` one run planted there is not what the next workspace's checkout runs, and `sandbox-dev` keeps mise's shims in `/tmp`. Toolchains mise installed into `/cache/mise` are shared like packages. Never put a `/cache` folder on an image's or the `env`'s `PATH` (the container runtime resolves the first `sh` with it).
:::

## The manager and its tools

<<< @/snippets/workspaces.ts#setup

The coding tools are not yours to edit, so the approval for `bash` sits in the agent's `beforeToolExecution` hook: `approve()` there pauses the run (keeping its workspaces on this replica) until someone answers, and a refused command reaches the model as a `ToolDeniedError` tool error. See [Approvals & Hooks](/guide/approvals#gating-tools-you-did-not-write).

`workspaces.tools()` gives the model two tools; `codingTools(workspaces)` adds seven more. Every tool resolves its workspace with the calling run's id, so a run can only reach its own workspaces.

| Tool | Package | What it does |
|---|---|---|
| `create_workspace` | sandbox | `{ repo?, ref?, image? }`: a shallow checkout of `repo` at `ref`, or an empty git repository, in the image asked for; the same repository again returns the same workspace (`reused: true`) |
| `dispose_workspace` | sandbox | `{ workspace? }`: disposes one workspace |
| `read_file` | coding | A line range of a text file (at most 2000 lines, 65 536 characters) |
| `write_file` | coding | Replaces a file, creating directories |
| `edit_file` | coding | Replaces an exact string, once (or every match with `replaceAll`); edits and writes of one file run one after the other, so several in one step all apply |
| `grep` | coding | `git grep -E` over tracked and untracked files |
| `list_files` | coding | Tracked and untracked files, git-ignored ones skipped |
| `bash` | coding | `sh -c <command>` inside the workspace, exit code and capped output |
| `git_diff` | coding | `git status --short` and the unified diff |

The coding tools take an optional `workspace` id; omitted, they use the run's only workspace. The model sees every workspace at `/workspace`, whatever the provider maps it to. See the [`@chamvi/coding` reference](/reference/coding) for inputs and results.

With [`@chamvi/app`](/guide/app#modules), `sandboxModule()` (`@chamvi/sandbox/module`) builds the manager, attaches and closes it and provides it on the engine: a tools factory takes it with `injectSandboxContext(ctx)` and builds `manager.tools()` and `codingTools(manager)` per execution, without importing the module instance (see [Context](/guide/tools#context-shared-instances-for-tools)). A hand-built engine calls `provideSandboxContext(engine, manager)` once after `new Engine()`.

A run may hold `maxWorkspacesPerRun` (3) workspaces at once. Repositories are `owner/name` (GitHub) or an `https:` URL without credentials, query or fragment; `allowRepo` narrows them, `allowFileRepos` adds `file:///absolute/path` for development. Refs are plain branch, tag or commit names that git can never read as an option or a range.

## Lifecycle

A workspace is keyed by run and repository, and its lifetime follows the run: containers sleep forever and pods have no deadline, so nothing kills a workspace while its run lives, also through a 24 hour approval. It lives until the first of:

- the run settles: `completed`, `failed` or `cancelled` (through `workspaces.attach(engine)`, also for the workspaces another replica created: with `isSettled` those go with the garbage collection a settled run starts, at most one per 10 minutes). A run `waiting` for an approval or `interrupted` keeps its workspaces.
- `dispose_workspace`, or `workspaces.release(runId, id?)`
- its hard cap, `limits.maxLifetimeMs` (default 7 days from its creation, never renewed), checked on every use
- it was found gone and nothing finds it again: its container was removed, its pod failed, was evicted or deleted, or its local directory was removed. The call that found it says "workspace ... is gone; call create_workspace for a new one"; the next call asks the provider again (a stopped container comes back, see below), and `create_workspace` creates a new one when nothing is found
- garbage collection, the only reaper: `acquire` (and a settled run `attach` sees) runs `workspaces.collectGarbage()` at most every 10 minutes. It removes expired workspaces and, with `isSettled` (which `sandboxModule()` answers through the engine), those whose run settled, also when the replica that ran it was down; with a named deployment (see below) also those whose run no longer exists

**A run finds its workspaces again** after an approval pause, a restart or on another replica of the same Docker host or Kubernetes cluster: on a miss the manager asks the provider (`find`) for the run's workspaces by label (local: the folder records) and adopts them, with their files, repository and ref. A stopped Docker container (a host or daemon restart) is started again; its volume still holds the work. That holds in the process that held it too: the call that hit the stopped container fails as gone, and the manager forgets the workspace without removing it, so the next call finds it again, restarted. Moving a workspace between hosts is not supported.

`workspaces.close()` at shutdown (call it **after** `engine.drain()`) disposes nothing a live run holds (`close({ dispose: true })` disposes those too, which `sandboxModule()` does when the store is a `MemoryStore`, since no run of it resumes after the restart): it aborts the creates still in flight (disposing what they made) and waits for them and for every disposal already started, at most 30 seconds (`close({ timeoutMs })`), then reports what is left to `onError`.

Several deployments (dev and prod, CI) may share one Docker host or namespace: every workspace carries the manager's `deployment` (`CHAMVI_DEPLOYMENT` with the module, default `default`), and `find` and the garbage collection only see their own. Give every app on a shared host its own `CHAMVI_DEPLOYMENT`: `sandboxModule()` treats a run its engine does not know as finished only in a named deployment, since in `default` that run may belong to another app. So with the default, the workspaces of runs the store no longer holds (a `MemoryStore` app that crashed instead of stopping) stay until `maxLifetimeMs`; with a named deployment they go on the next collection, and two apps sharing one name remove each other's workspaces.

For development, the local provider runs everything in a temporary directory:

<<< @/snippets/workspaces.ts#local

## Commands, output and timeouts

- `exec` takes **argv only**; the only shell is the `bash` tool's `sh -c` inside the workspace.
- stdout and stderr are capped at 64 KiB each (`stdoutTruncated`, `stderrTruncated`); output past the cap is drained, never buffered, so `yes` cannot block the child or fill the host's memory.
- A command times out after `timeoutMs` (default 5 minutes, at most 30, never past the workspace's hard cap) with `timedOut: true` as a result, not an error. The whole process group is killed, background jobs included: local sends `SIGKILL` to the group, Docker and Kubernetes run every command inside GNU `timeout -k 5`. A command that exits on its own returns with its exit code even when a background job it started (`node server.js & echo started`) holds its output (after about 2 seconds); the job runs on until the workspace is disposed, so the next call can probe the server.
- A `cwd` that is no directory in the workspace rejects with a `SandboxError` on every provider.
- **Abort** (a cancelled run, a run timeout): local kills the process group. Docker and Kubernetes **detach**: the client stops waiting, and the command runs on until its `timeout` fires or the workspace is disposed, which the settled run's `attach` does right after.
- A sandbox failure (a failed create or checkout, an unknown or expired workspace, a daemon or API error) is a `SandboxError`: a tool error the model sees, never a failed run.

## Why the coding tools are not effect tools

`write_file`, `edit_file`, `bash`, `create_workspace` and `dispose_workspace` change state, yet they are plain [`defineTool()`](/guide/tools) tools, not [effect tools](/guide/effect-tools). An effect record lives in the store forever; a workspace can be removed, expire or be collected. A redone step could then run on a fresh workspace, where a recorded "applied" result would skip the write and leave the workspace and the history out of step. Effect tools would also merge two identical calls of one step (`npm test` twice) into one.

Re-applying is safe instead: `write_file` is idempotent, `edit_file` fails with "oldString not found" when it already applied (the model sees that), and `bash` runs in a disposable sandbox. Nothing outside the workspace changes; pushing is not part of these tools.

## Security model

- **The model runs untrusted code.** Whatever it reads (an issue body, a README, a test's output) can steer what it runs: prompt injection. Run untrusted repositories on Docker or Kubernetes, never local, narrow `allowRepo`, and put `bash` behind an [approval](/guide/approvals#gating-tools-you-did-not-write) (a `beforeToolExecution` hook calling `approve()`, as above) where a human should see each command.
- **Local isolates nothing.** Commands run as the host user with your files and network in reach. It only keeps the host environment out (just `PATH`, its own `HOME` and `TMPDIR`) and kills process groups. Background jobs die with the process (on its `exit`): after a restart a local workspace keeps its files but not its jobs, and a process killed with SIGKILL leaves them running.
- **Docker and Kubernetes enforce** the container boundary: no privileged mode, only the package-manager capabilities (none in the hardened mode, which also drops root and makes the root filesystem read-only), no privilege escalation, no host mount but the cache, cpu and memory limits (pids on Docker, the kubelet's `podPidsLimit` on Kubernetes; storage on Kubernetes), a hard lifetime cap through the garbage collection, and no host or chamvi environment. Kubernetes mounts no service account token.
- **No credentials enter a workspace.** URLs with credentials are refused (and never echoed in an error), git's credential helpers are reset for the fetch, and only `SANDBOX_ENV`, the cache variables and your configured `env` reach a command. Private repositories are not supported yet.
- **A sandbox is a code-execution boundary, not a network boundary.** On a Docker bridge a workspace reaches the host gateway (the chamvi API, Postgres, an MCP server), other containers and cloud metadata (`169.254.169.254`); on Kubernetes every service in the cluster. Until the Helm chart's NetworkPolicy ships, add one yourself (select `app.kubernetes.io/component=sandbox`, allow only GitHub and the npm registry, deny the chamvi namespace and the metadata address), or on Docker a network with `enable_icc=false` plus host firewall rules.
- **Docker socket access is root on the host.** Give chamvi a socket proxy or rootless Docker rather than the raw socket.
