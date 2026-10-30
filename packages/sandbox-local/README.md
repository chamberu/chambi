<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/sandbox-local" width="128" height="128" />
</p>

<h1 align="center">@chamvi/sandbox-local</h1>

<p align="center">
    <b>Workspaces in a temporary directory, for development and tests.</b><br>
    Commands are spawned on the host as your user: no container, no isolation.<br>
    Use <code>@chamvi/sandbox-docker</code> or <code>@chamvi/sandbox-k8s</code> for anything a model may steer.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/sandbox-local"><img src="https://img.shields.io/npm/v/@chamvi/sandbox-local" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/sandbox-local/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/sandbox-local" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [What it does and does not do](#what-it-does-and-does-not-do)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/sandbox-local @chamvi/sandbox @chamvi/core ai --save
```

ESM only, Node.js `>=24.3.0`, a POSIX host (Linux or macOS) with `git` on the `PATH`. `@chamvi/core` and `@chamvi/sandbox` are peer dependencies; there are no other runtime dependencies.

## Usage

```typescript
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { IWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';

// no isolation: commands run as your user, for development and tests only
export function createDevWorkspaces(root?: string): IWorkspaceManager {
    return createWorkspaceManager({ provider: createLocalSandbox({ root }) });
}
```

Each workspace is a folder `<root>/<id>/` (`root` defaults to `<os tmpdir>/chamvi-workspaces`) with `repo/` (the model's `/workspace`), `home/`, `tmp/` and a `workspace.json` record (run id, deployment, repository, ref, `env`, creation and expiry) that `find` rebuilds the workspace from and the garbage collection reads, so a restarted process reaches a run's workspace again. The create's `env` is written to that record on disk, so the folder is `0700` and the record `0600` (owner only). `dispose()` removes the folder.

## What it does and does not do

**No isolation.** A command runs as the host user with the host's filesystem, network and processes in reach. `/workspace` paths in tool input are confined to the folder, symbolic links included (a path whose real path leaves the folder, say through a link the repository brings, is a `ValidationError`; checked before each call, so a command running at the same time can still swap a link in), but `bash` can `cd /` and read your SSH keys. Use it on your machine with models and repositories you trust, and in tests.

What it does enforce:

- **Environment**: only the host `PATH`, `HOME` and `TMPDIR` inside the workspace folder, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1` (a system gitconfig may name a credential helper such as macOS `osxkeychain`), `NPM_CONFIG_UPDATE_NOTIFIER=false`, `CI=true`, the package-cache variables (`XDG_CACHE_HOME`, `npm_config_cache`, `PIP_CACHE_DIR`, `GOMODCACHE`, `GOCACHE`, `COMPOSER_CACHE_DIR`) under `<root>/.cache`, shared by every workspace of the root (`cache: false` sets none), and the configured `env`. No other host variable (tokens, cloud credentials) reaches a command.
- **Timeouts and abort**: every command starts its own process group (`detached`); a timeout, an abort or a dispose kills the whole group with `SIGKILL`, backgrounded grandchildren included. The kill timer is cleared when the child exits, so it never signals a reused pid. A command that exits while a background job it started still holds its output (`node server.js & echo started`) returns 2 s (`KILL_GRACE_MS`) after its exit with its own exit code and `timedOut: false`; the job keeps running until the workspace is disposed, as on Docker and Kubernetes, also with its output redirected (`nohup node server.js > log 2>&1 &`). The workspace remembers the process group of such a command and forgets it once the group ended (checked every second, `LINGER_CHECK_MS`; a group id is only reused after every member is gone), so the dispose kills the jobs but not a group that took the id over later. The one window left is a group that ends and whose id another process group takes within that second. Only the process that spawned a job knows its group, so the jobs die with that process too (on its `exit`, which the `chamvi` CLI reaches on SIGTERM and SIGINT): unlike a Docker or Kubernetes workspace, a local one found again after a restart keeps its files but has no background jobs, and a process killed with SIGKILL (or one that exits without an `exit` event, e.g. on an unhandled SIGTERM) leaves its jobs running, outside any later dispose.
- **Output caps**: 64 KiB per stream, drained past the cap.
- **No images**: a local workspace runs no container image, so `create_workspace` never offers `image` on this provider (a requested one is a `ValidationError`).
- **Lifetime**: `limits.maxLifetimeMs` (default 7 days) is the expiry; `collectGarbage({ deployment, isSettled })` deletes the deployment's expired workspace folders under `root` (also those of crashed processes) and, with `isSettled`, those of settled runs, disposing open ones first. Folders that are no workspace are left alone. A folder that cannot be deleted does not stop the pass: the others go, and one `SandboxError` with the count and the first failure is thrown at the end.

`cpu`, `memory`, `storage` and `pids` are not enforced, so `limits` takes `maxLifetimeMs` only.

## Options

`createLocalSandbox(options?)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `root` | `string` | `<os tmpdir>/chamvi-workspaces` | Directory holding one folder per workspace |
| `env` | `Record<string, string>` | none | Added to every workspace's environment (wins over the defaults) |
| `limits` | `{ maxLifetimeMs? }` | `604_800_000` | The workspace's hard lifetime cap |
| `cache` | `boolean` | `true` | Point the package caches into `<root>/.cache` |
| `clock` | `IClock` | `systemClock` | Expiry and timeouts |

## API

| Export | Kind | Purpose |
|---|---|---|
| `createLocalSandbox` | function | The `ISandboxProvider` (`name: 'local'`) |

Types: `LocalSandboxOptions`.

## License

Published under [Apache License 2.0](./LICENSE).
