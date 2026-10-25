# Workspaces & Coding

An agent that reproduces a bug, runs tests or fixes code needs a place to run commands. chamvi gives each run **disposable workspaces**: a directory, optionally a checkout of a git repository with its history, in which the model runs commands and edits files through tools. Workspaces come from a **sandbox provider** and are held by a **workspace manager** that disposes them when the run settles.

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

`workspaces.tools()` gives the model five tools; `codingTools(workspaces)` adds eleven more. Every tool resolves its workspace with the calling run's id, so a run can only reach its own workspaces.

| Tool | Package | What it does |
|---|---|---|
| `create_workspace` | sandbox | `{ repo?, ref?, image? }`: a checkout of `repo` at `ref` with its history and the default branch beside it (`defaultBranch`), or an empty git repository, in the image asked for; the same repository again returns the same workspace (`reused: true`) |
| `dispose_workspace` | sandbox | `{ workspace? }`: disposes one workspace |
| `git_fetch` | sandbox | `{ remote?, refspec? }`: fetches with the run's credentials, every branch into `origin/*` by default |
| `git_pull` | sandbox | `{ remote?, branch?, rebase? }`: fetches a branch and merges it, or rebases onto it; conflicts come back in the result |
| `git_push` | sandbox | `{ remote?, branch?, force?, setUpstream? }`: pushes under the [push policy](#git-and-credentials) |
| `read_file` | coding | A line range of a text file (at most 2000 lines, 65 536 characters, files up to 16 MiB); an image as an image the model sees; any file up to 1 MiB as base64; the output logs of `bash` |
| `write_file` | coding | Replaces a file (text, or bytes as base64), creating directories |
| `edit_file` | coding | Replaces an exact string, once (or every match with `replaceAll`); edits and writes of one file run one after the other, so several in one step all apply |
| `multi_edit` | coding | Several exact-string edits of one file in order; nothing is written when one fails |
| `grep` | coding | ripgrep when the image has it, else `git grep -E`, else `grep -rE`; hidden files always, git-ignored ones with `includeIgnored` |
| `glob` | coding | Files by a `**` pattern, git-ignored ones with `includeIgnored` |
| `list_files` | coding | Tracked and untracked files, git-ignored ones with `includeIgnored` |
| `bash` | coding | A shell that keeps its working directory and exported variables between calls; long output in a log file with an excerpt in the result; `background: true` for servers and watchers |
| `bash_output` | coding | New output and the status of a background job, from a byte offset |
| `bash_kill` | coding | Stops a background job and every process it started |
| `git_diff` | coding | `git status --short` and the unified diff |

The coding tools take an optional `workspace` id; omitted, they use the run's only workspace. The model sees every workspace at `/workspace`, whatever the provider maps it to. See the [`@chamvi/coding` reference](/reference/coding) for inputs and results.

With [`@chamvi/app`](/guide/app#modules), `sandboxModule()` (`@chamvi/sandbox/module`) builds the manager, attaches and closes it and provides it on the engine: a tools factory takes it with `injectSandboxContext(ctx)` and builds `manager.tools()` and `codingTools(manager)` per execution, without importing the module instance (see [Context](/guide/tools#context-shared-instances-for-tools)). A hand-built engine calls `provideSandboxContext(engine, manager)` once after `new Engine()`.

A run may hold `maxWorkspacesPerRun` (3) workspaces at once; raise it on the manager (`createWorkspaceManager({ maxWorkspacesPerRun })`), and the tool error says so. Repositories are `owner/name` (GitHub) or an `https:` URL without credentials, query or fragment; `allowRepo` narrows them, `allowFileRepos` adds `file:///absolute/path` for development. Refs are plain branch, tag or commit names that git can never read as an option or a range.

## Git and credentials

A checkout has the full history of `ref` and the remote's default branch fetched next to it (`origin/<defaultBranch>`), so the model can merge or rebase onto the base branch; a branch is checked out tracking `origin/<branch>`, a tag or commit detached. `depth` on the manager makes it shallow for huge repositories.

Private repositories and pushes need credentials. The manager asks its `credentials` sources in order, the first answer wins, none is anonymous:

<<< @/snippets/workspaces.ts#credentials

- `staticGitCredentials([{ host, path?, username?, token }])`: personal access tokens of GitHub (`x-access-token`), GitLab (`oauth2`, also project and deploy tokens) or any https host; `path` narrows a token to an owner or a repository, the longest match wins. `sandboxModule()` also reads them as JSON from `CHAMVI_GIT_TOKENS`.
- `githubAppCredentials(app, { permissions? })` (`@chamvi/github`): a token of the App's installation limited to the one repository, `contents: read` to read, `contents: write` plus `permissions` (e.g. `{ workflows: 'write' }`, which a change under `.github/workflows` needs) to push, cached until shortly before it expires. `githubModule()` contributes it to `sandboxModule()` on its own (`credentials: false` turns that off), and `app.botIdentity()` gives the bot's commit identity for `author`.

`credentialMode` decides how a token reaches git:

- **`workspace` (default)**: plain git in `bash` works, private dependencies of the same host included. chamvi writes a credential helper and a 0600 credentials file under the workspace's `$HOME/.chamvi/` after the create, and rewrites the file before a command once a token in it expires within ten minutes (GitHub App tokens live an hour), also in a workspace found again after a restart. The model can read the token, so every tool result, file read and error passes through a redaction of the issued tokens (`[redacted]`). In this mode the push policy binds `git_push` only: a `git push` in `bash` is held only by the token's own scope and the host's branch protection.
- **`tools`**: no credential ever enters the workspace. Only the checkout and `git_fetch`, `git_pull` and `git_push` authenticate, each through a one-shot credential helper that reads the token from that command's stdin; a plain `git fetch` in `bash` works for public repositories only. While that one git process runs, a root process in the same container could read its memory: keep tokens short-lived and narrow.

Either way the git tools put the repository URL on the command line and look the credential up for it, never trusting `remote.*.url` (the repository or the model can rewrite it); another repository (a fork's head branch) passes `normalizeRepo` and `allowRepo` and gets its own lookup. Hooks are off for authenticated calls, SSH URLs are refused.

The push policy (`push` on the manager): `mode: 'auto'` pushes, `'approve'` asks through [`approve()`](/guide/approvals) first (the run's source channel when it has an `out`, e.g. a PR comment, else `push.channel`, else the inbox), with the commit list in the body; a denial is a `ToolDeniedError`. Without `allowBranch` the repository's default branch (read from the remote at push time; a push whose remote does not answer it fails) is refused and every other branch allowed; `allowForce: true` allows `force: true`, always as `--force-with-lease`. `author: { name, email }` sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*` in every workspace.

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

## The shell

`bash` behaves like a terminal tab. The working directory and the exported variables carry over from one call to the next: `cd src` in one call, `npm test` in the next runs in `src`; `export NODE_ENV=test` stays set. The result's `cwd` is where the next call starts. A `cwd` argument runs that one call elsewhere and leaves the kept directory alone. The command runs in bash when the image has it, else in `sh`. An `exit 1`, a failed `cd` or `set -e` keep the state consistent; functions, aliases and shell options are not kept, and neither is the `unset` of a variable the workspace started with. A call that timed out keeps the state from before it.

The whole output of every call goes to `~/.chamvi/out/<id>.stdout.log` and `.stderr.log` (`stdoutLog`, `stderrLog`), outside `/workspace`; the newest 100 logs are kept, and older ones go once the logs take more than four times `outputLogMaxBytes` (256 MiB by default; the logs of a call still running always stay, also those of a parallel call), since `HOME` shares the workspace's disk. A call that cannot write its logs or its report (no space left in `HOME`, or a folder that takes no file) is a `SandboxError` saying so, never a garbled result. Up to 32 KiB per stream the result holds all of it; past that the first 8 KiB and the last 24 KiB with a `[... <n> bytes cut, full output in <log>]` line between them, so a long test run still shows the summary at its end. `read_file` reads a log by line range, `grep` searches it, and `bash` can `tail` it.

Servers and watchers run as **background jobs**: `bash({ command: 'npm run dev', background: true })` returns `{ job, status: 'running' }` at once. `bash_output({ job, offset? })` returns the job's new output (stdout and stderr together, at most 32 KiB from `offset`; pass `nextOffset` to read on) and its status (`running`, `exited` with the exit code, `killed`, or `lost` after a container restart); a job whose output passes `outputLogMaxBytes` is killed with every process it started (checked every second, `outputCapped: true`, status `killed`) and its output cut back to the cap; `bash_kill({ job })` stops it with every process it started (TERM, then KILL after 3 seconds). A job lives in a process group of its own and dies with the workspace; on local, also with the chamvi process. Docker workspaces run `docker-init` as PID 1 (`Init: true`) and Kubernetes pods share the process namespace with the pause container, so the processes a job or a call leaves behind are reaped whatever the image (an image without `tini` runs `sleep` as PID 1, which reaps nothing, so every orphan would stay a zombie and count against the pid limit).

`HOME` is `/home/sandbox` in every container and pod (`WORKSPACE_HOME`, a disk-backed volume of the workspace), so the shell state, the logs and the jobs survive a container restart and never fill the memory-backed `/tmp`. Local keeps `<root>/<id>/home`.

## Commands, output and timeouts

- `exec` takes **argv only**; the only shells are the coding tools' `sh -c` scripts inside the workspace, which take the command as an argument, never pasted into the script.
- `exec` caps stdout and stderr at 64 KiB each (`stdoutTruncated`, `stderrTruncated`); output past the cap is drained, never buffered, so `yes` cannot block the child or fill the host's memory. The `bash` tool writes the output to its log files instead, each capped at 64 MiB (`codingTools(manager, { outputLogMaxBytes })`): a command whose log passes the cap is killed with its jobs like a timeout (`outputCapped: true`) and the log keeps its first 64 MiB. A `background: true` job is capped the same way (see above); only a job the command leaves running (`cmd &`) writes on uncapped after the call.
- A command times out after `timeoutMs` (default 5 minutes, at most 30, never past the workspace's hard cap) with `timedOut: true` as a result, not an error. The whole process group is killed, background jobs included: local sends `SIGKILL` to the group, Docker and Kubernetes run every command inside GNU `timeout -k 5`. A command that exits on its own returns with its exit code even when a background job it started (`node server.js & echo started`) holds its output (after about 2 seconds); the job runs on until the workspace is disposed, so the next call can probe the server.
- A `cwd` that is no directory in the workspace rejects with a `SandboxError` on every provider.
- **Abort** (a cancelled run, a run timeout): local kills the process group. Docker and Kubernetes **detach**: the client stops waiting, and the command runs on until its `timeout` fires or the workspace is disposed, which the settled run's `attach` does right after.
- A sandbox failure (a failed create or checkout, an unknown or expired workspace, a daemon or API error) is a `SandboxError`: a tool error the model sees, never a failed run.

## Why the coding tools are not effect tools

`write_file`, `edit_file`, `bash`, `create_workspace` and `dispose_workspace` change state, yet they are plain [`defineTool()`](/guide/tools) tools, not [effect tools](/guide/effect-tools). An effect record lives in the store forever; a workspace can be removed, expire or be collected. A redone step could then run on a fresh workspace, where a recorded "applied" result would skip the write and leave the workspace and the history out of step. Effect tools would also merge two identical calls of one step (`npm test` twice) into one.

Re-applying is safe instead: `write_file` is idempotent, `edit_file` and `multi_edit` fail with "oldString not found" when it already applied (the model sees that), and `bash` runs in a disposable sandbox. Nothing outside the workspace changes. `git_fetch`, `git_pull` and `git_push` are plain tools too: fetching or pushing the same commit again changes nothing, and a remote that moved refuses a stale push.

## Security model

- **The model runs untrusted code.** Whatever it reads (an issue body, a README, a test's output) can steer what it runs: prompt injection. Run untrusted repositories on Docker or Kubernetes, never local, narrow `allowRepo`, and put `bash` behind an [approval](/guide/approvals#gating-tools-you-did-not-write) (a `beforeToolExecution` hook calling `approve()`, as above) where a human should see each command.
- **Local isolates nothing.** Commands run as the host user with your files and network in reach. It only keeps the host environment out (just `PATH`, its own `HOME` and `TMPDIR`) and kills process groups. Background jobs die with the process (on its `exit`): after a restart a local workspace keeps its files but not its jobs, and a process killed with SIGKILL leaves them running.
- **Docker and Kubernetes enforce** the container boundary: no privileged mode, only the package-manager capabilities (none in the hardened mode, which also drops root and makes the root filesystem read-only), no privilege escalation, no host mount but the cache, cpu and memory limits (pids on Docker, the kubelet's `podPidsLimit` on Kubernetes; storage on Kubernetes), a hard lifetime cap through the garbage collection, and no host or chamvi environment. Kubernetes mounts no service account token.
- **Credentials stay out of URLs, the environment, logs and steps.** URLs with credentials are refused (and never echoed in an error), every configured credential helper is reset for chamvi's own git calls, and only `SANDBOX_ENV`, the cache variables, the commit identity and your configured `env` reach a command. In `credentialMode: 'workspace'` a short-lived token lives in a 0600 file of the workspace, redacted from everything the model or the store sees; `tools` keeps it out entirely (see [Git and credentials](#git-and-credentials)). Redaction replaces whole token values: a token a command transforms (reversed, split across two `bash_output` reads) can slip through.
- **A sandbox is a code-execution boundary, not a network boundary.** On a Docker bridge a workspace reaches the host gateway (the chamvi API, Postgres, an MCP server), other containers and cloud metadata (`169.254.169.254`); on Kubernetes every service in the cluster. Until the Helm chart's NetworkPolicy ships, add one yourself (select `app.kubernetes.io/component=sandbox`, allow only GitHub and the npm registry, deny the chamvi namespace and the metadata address), or on Docker a network with `enable_icc=false` plus host firewall rules.
- **Docker socket access is root on the host.** Give chamvi a socket proxy or rootless Docker rather than the raw socket.
