# Workspaces & Coding

An agent that reproduces a bug, runs tests or fixes code needs a place to run commands. chamvi gives each run **disposable workspaces**: a directory, optionally a shallow checkout of a git repository, in which the model runs commands and edits files through tools. Workspaces come from a **sandbox provider** and are held by a **workspace manager** that disposes them when the run settles.

```bash
npm install @chamvi/sandbox @chamvi/coding @chamvi/sandbox-docker
```

## Providers

| Provider | Package | A workspace is | Isolation |
|---|---|---|---|
| local | [`@chamvi/sandbox-local`](/reference/sandbox#chamvi-sandbox-local) | a temporary directory on the host | **none**: development and tests only |
| Docker | [`@chamvi/sandbox-docker`](/reference/sandbox#chamvi-sandbox-docker) | one container | uid 1000, read-only root, no capabilities, `no-new-privileges`, cpu, memory and pid limits |
| Kubernetes | [`@chamvi/sandbox-k8s`](/reference/sandbox#chamvi-sandbox-k8s) | one pod | non-root, read-only root, no capabilities, no service account token, resource limits |

All three pass the same workspace contract (`describeWorkspaceContract` from `@chamvi/test-kit`): argv-only exec, path checks, output caps, process-group kills on timeout, and dispose semantics.

<<< @/snippets/sandbox-providers.ts#docker

<<< @/snippets/sandbox-providers.ts#k8s

The container providers use `ghcr.io/chamvi/sandbox-node:24` by default (Node.js 24, npm, git, `tini`, GNU coreutils), built for `linux/amd64` and `linux/arm64`. Pin a digest in production. See [Docker Image](/deployment/docker#sandbox-image).

## The manager and its tools

<<< @/snippets/workspaces.ts#setup

The coding tools are not yours to edit, so the approval for `bash` sits in the agent's `beforeToolExecution` hook: `approve()` there pauses the run (keeping its workspaces on this replica) until someone answers, and a refused command reaches the model as a `ToolDeniedError` tool error. See [Approvals & Hooks](/guide/approvals#gating-tools-you-did-not-write).

`workspaces.tools()` gives the model two tools; `codingTools(workspaces)` adds seven more. Every tool resolves its workspace with the calling run's id, so a run can only reach its own workspaces.

| Tool | Package | What it does |
|---|---|---|
| `create_workspace` | sandbox | `{ repo?, ref? }`: a shallow checkout of `repo` at `ref`, or an empty git repository; the same repository again returns the same workspace (`reused: true`) |
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

`workspaces.close()` at shutdown (call it **after** `engine.drain()`) disposes nothing a live run holds: it aborts the creates still in flight (disposing what they made) and waits for them and for every disposal already started, at most 30 seconds (`close({ timeoutMs })`), then reports what is left to `onError`.

Several deployments (dev and prod, CI) may share one Docker host or namespace: every workspace carries the manager's `deployment` (`CHAMVI_DEPLOYMENT` with the module, default `default`), and `find` and the garbage collection only see their own. Give every app on a shared host its own `CHAMVI_DEPLOYMENT`: `sandboxModule()` treats a run its engine does not know as finished only in a named deployment, since in `default` that run may belong to another app. So with the default, the workspaces of runs the store no longer holds (a `MemoryStore` app restarted) stay until `maxLifetimeMs`; with a named deployment they go on the next collection, and two apps sharing one name remove each other's workspaces.

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
- **Docker and Kubernetes enforce** a non-root user, a read-only root filesystem, no capabilities, no privilege escalation, cpu and memory limits (pids on Docker, the kubelet's `podPidsLimit` on Kubernetes; storage on Kubernetes), a hard lifetime cap through the garbage collection, and no host or chamvi environment. Kubernetes mounts no service account token.
- **No credentials enter a workspace.** URLs with credentials are refused (and never echoed in an error), git's credential helpers are reset for the fetch, and only `SANDBOX_ENV` plus your configured `env` reach a command. Private repositories are not supported yet.
- **A sandbox is a code-execution boundary, not a network boundary.** On a Docker bridge a workspace reaches the host gateway (the chamvi API, Postgres, an MCP server), other containers and cloud metadata (`169.254.169.254`); on Kubernetes every service in the cluster. Until the Helm chart's NetworkPolicy ships, add one yourself (select `app.kubernetes.io/component=sandbox`, allow only GitHub and the npm registry, deny the chamvi namespace and the metadata address), or on Docker a network with `enable_icc=false` plus host firewall rules.
- **Docker socket access is root on the host.** Give chamvi a socket proxy or rootless Docker rather than the raw socket.
