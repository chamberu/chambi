<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/sandbox-docker" width="128" height="128" />
</p>

<h1 align="center">@chamvi/sandbox-docker</h1>

<p align="center">
    <b>One container per workspace, for chamvi agents on a Docker host.</b><br>
    Root inside, so <code>apt</code> and every package manager work; strict at the edge: a few capabilities, <code>no-new-privileges</code>,<br>
    cpu, memory and pid limits, no host mount but the package cache, every command inside GNU <code>timeout</code>.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/sandbox-docker"><img src="https://img.shields.io/npm/v/@chamvi/sandbox-docker" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/sandbox-docker/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/sandbox-docker" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [The container](#the-container)
- [Image](#image)
- [Cache](#cache)
- [Security](#security)
- [Timeouts and abort](#timeouts-and-abort)
- [Garbage collection](#garbage-collection)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/sandbox-docker @chamvi/sandbox @chamvi/core ai --save
```

ESM only, Node.js `>=22`. `@chamvi/core` and `@chamvi/sandbox` are peer dependencies. The Docker API is reached through [dockerode](https://www.npmjs.com/package/dockerode) 5 (with `@types/dockerode`, since the options take a `Dockerode` client); it pulls in `docker-modem`, `tar-fs`, `@balena/dockerignore` and the gRPC packages `@grpc/grpc-js`, `@grpc/proto-loader` and `protobufjs` as its own dependencies. [smob](https://www.npmjs.com/package/smob) is the only other runtime dependency.

## Usage

```typescript
import type { ISandboxProvider } from '@chamvi/sandbox';
import { createDockerSandbox } from '@chamvi/sandbox-docker';

export function createSandbox(): ISandboxProvider {
    // DOCKER_HOST or /var/run/docker.sock; nothing connects before the first create()
    return createDockerSandbox({
        network: 'bridge',
        limits: { memory: '1Gi' },
    });
}
```

Pass the provider to `createWorkspaceManager({ provider })` from `@chamvi/sandbox`. Creating it contacts nothing; the first `create()` does.

## The container

Each workspace is a container `chamvi-ws-<id>`:

| Setting | Value |
|---|---|
| User | `user`, default `0:0` (`DEFAULT_USER`), also of every command |
| Command | `sh -c` sleeping until `expiresAt` (an absolute deadline, so a container `find` starts again after a host or daemon restart still stops at the same time, or at once past it), with the image's entrypoint replaced (`Entrypoint: []`): the container stops itself at `expiresAt` even when no collection runs; the garbage collection removes it |
| Init | `Init: true`: docker-init is pid 1 and reaps orphaned processes (background jobs, the trees an exec timeout kills) for any image, also one without an init, whose zombies would otherwise fill `PidsLimit` |
| Root filesystem | writable; read-only with `readOnlyRoot` |
| Capabilities | all dropped; a root user gets back `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `FSETID`, `SETUID`, `SETGID`, `KILL` (`ROOT_CAPABILITIES`); `no-new-privileges:true`, not privileged |
| Limits | `NanoCpus` from `cpu`, `Memory` and `MemorySwap` (no swap) from `memory`, `PidsLimit` from `pids` |
| `/workspace` | an anonymous volume, removed with the container (`remove({ force: true, v: true })`) |
| `/home/sandbox` | HOME (`WORKSPACE_HOME`): an anonymous volume on disk, kept across a restart, removed with the container |
| `/cache` | an anonymous volume of its own, removed with the container; with `cache: { volume }` that named volume, shared by every workspace using it |
| `/tmp` | a tmpfs of `tmpSize` (default 1 GiB, `TMP_SIZE`; `exec`, `nosuid`, `nodev`) |
| Network | `network` (default `bridge`) |
| Environment | `SANDBOX_ENV`, the cache variables (`CACHE_ENV`) and `env`, nothing from the host |
| Labels | `app.kubernetes.io/managed-by=chamvi`, `app.kubernetes.io/component=sandbox`, `chamvi.dev/run=<runId>`, `chamvi.dev/workspace=<id>`, `chamvi.dev/deployment=<deployment>`, `chamvi.dev/repo-key=<hash>` (with a repository), `chamvi.dev/created-at` and `chamvi.dev/expires-at` (epoch ms), `chamvi.dev/repo`, `chamvi.dev/ref`, `chamvi.dev/image` |

`limits.storage` is not enforced: a default volume has no size (use a storage driver with quotas, or the Kubernetes provider). Commands run through the Docker exec API in `/workspace`; a file is read with `cat` and written with `head -c` from stdin.

**Hardened mode**: `createDockerSandbox({ user: '1000:1000', readOnlyRoot: true })` gives the container of earlier versions: uid 1000, a read-only root, no capability at all. `apt` and root-only installs then fail; toolchains still install into HOME with mise. Before the checkout the provider opens the cache to that user (one exec as root, which owns the mount point Docker makes for an image without `/cache`, so it makes `/cache` and the empty top-level `CACHE_ENV` folders writable without any capability), so any image works there. Only those folders: a root workspace leaves root-owned folders deep in a cache (npm's `_cacache`) that the hardened user cannot write, so never point a non-root `user` at a `cache.volume` a root workspace or another user wrote to.

## Image

The default image is `ghcr.io/chamvi/sandbox-dev:trixie` (`DEFAULT_SANDBOX_IMAGE`): Debian, git, curl, ripgrep, jq, build-essential, `tini` and [mise](https://mise.jdx.dev), which installs any toolchain at runtime (`mise use -g node@22`, `mise install`), built for `linux/amd64` and `linux/arm64` from [`images/sandbox-dev`](../../images/sandbox-dev). Tags: `trixie` (rebuilt on changes and weekly) and `trixie-<short sha>` (pushed once per commit that changes the image).

- A run may pick an image (`create_workspace({ image })`) only when the manager has an allow-list (`allowImage`, or `CHAMVI_SANDBOX_IMAGES` in `sandboxModule()`); without one the tool has no `image` parameter.
- `pull: 'missing'` (default) pulls an image once when the daemon lacks it, `'always'` before every create (a mutable tag then follows its rebuilds), `'never'` never. It covers every image: the provider's, the manager's `image` and one a run asked for (`create_workspace({ image })`).
- Pin a digest in production (`image: 'ghcr.io/chamvi/sandbox-dev@sha256:...'`), or use `pull: 'always'`.
- The image's entrypoint is replaced, so an image whose entrypoint is a command (`["git"]`) works too.
- An image needs `sh`, `git` and a GNU `timeout` that takes `-k`, plus `cat`, `head`, `mkdir`, `dirname`, `cp`, `mv` and `rm`. `create` probes the first three once the container runs and fails with a `SandboxError` naming what is missing, before any checkout (and removes the container).

## Cache

Every workspace mounts `/cache` and gets `XDG_CACHE_HOME`, `npm_config_cache`, `PIP_CACHE_DIR`, `GOMODCACHE`, `GOCACHE` and `COMPOSER_CACHE_DIR` pointing into it (`CACHE_ENV`): package downloads only, never toolchains (mise keeps its installs in HOME, per workspace). By default `/cache` is an anonymous volume per workspace, removed with it.

`cache: { volume: 'chamvi-cache' }` mounts one named volume in every workspace instead, so a second install of the same packages is fast; it outlives every workspace (remove it with `docker volume rm` to reset it). **Risk**: a shared volume is a trust boundary shared by every run and agent on the host. A malicious package one run fetched can sit in the cache of another run; npm verifies integrity hashes, pip, Go's build cache and others less. Share a volume only between runs that trust each other, one volume per trust level.

## Security

- **Socket access is root on the host.** Whoever can talk to the Docker socket can start a privileged container. Give the chamvi process a [socket proxy](https://github.com/Tecnativa/docker-socket-proxy) that allows only containers, exec and images, or run [rootless Docker](https://docs.docker.com/engine/security/rootless/), rather than mounting `/var/run/docker.sock` into it.
- **Not a network boundary.** On `bridge` a workspace reaches the host gateway (the chamvi API, Postgres, an MCP server), other containers and cloud metadata at `169.254.169.254`. Use a dedicated network without inter-container traffic and firewall it:

  ```bash
  docker network create --opt com.docker.network.bridge.enable_icc=false chamvi-sandbox
  # then drop traffic from that bridge to the host gateway and 169.254.169.254 (iptables DOCKER-USER chain)
  ```

  and pass `network: 'chamvi-sandbox'`. `network: 'none'` cuts the network entirely; then only repo-less workspaces work, since the clone runs inside the container.
- **Root inside, not on the host.** A workspace runs as root with a writable root filesystem by default, so it can install anything; it is still no privileged container, holds only the capabilities package managers need, keeps `no-new-privileges` and mounts nothing of the host (a named `cache.volume` is the only volume shared between workspaces). Use the hardened mode (`user`, `readOnlyRoot`) where root in the container is too much.
- **Prompt injection**: what the model runs follows what it reads. Narrow `allowRepo` on the manager and put `bash` behind an approval where needed.

## Timeouts and abort

Every command runs as `timeout -k 5 <seconds> <argv>`; GNU `timeout` signals its whole process group, so backgrounded grandchildren go too. A client-side guard stops waiting 15 s (`EXEC_GRACE_MS`) after the timeout and reports exit 137 with the output so far. A command that exits while a background job it started holds its output returns about 2 s after its exit with its own exit code.

An abort (`signal`) **detaches**: dockerode tears down the exec stream, and the command runs on until its `timeout` fires or the workspace is disposed. Every settled run disposes its workspaces (`manager.attach(engine)`), so nothing outlives the run for long. A dispose removes the container, which kills whatever still runs.

A create's `signal` (aborted by `release(runId)` and `manager.close()`) drops its requests: the image pull (the daemon may finish it on its own), the container create (a container the daemon made anyway is removed) and the start. dockerode sets no request timeout by default, so a hanging daemon stalls a create or a removal. `manager.close()` gives up after its `timeoutMs` (30 s) and reports what is left; to bound every request, pass a client with a timeout: `createDockerSandbox({ docker: new Docker({ timeout: 60_000 }) })` (in ms, longer than your slowest image pull).

## Garbage collection

`find(runId, { deployment })` lists the run's containers by label, starts a stopped one again (a host or daemon restart; its volume still holds the work), also one whose handle this process holds and found gone (the manager forgets a gone workspace instead of disposing it), and rebuilds the workspace from the labels, so a run finds its workspace after a restart or on another replica sharing the daemon. `collectGarbage({ deployment, isSettled })` lists the deployment's containers with the managed labels and removes every one past its `chamvi.dev/expires-at` and, with `isSettled`, those of settled runs (open workspaces of this process are disposed first), including those of crashed processes and other replicas sharing the daemon. The manager calls it from `acquire` at most every 10 minutes. A container that cannot be removed does not stop the pass: the others go, and one `SandboxError` with the count and the first failure is thrown at the end.

## Options

`createDockerSandbox(options?)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `docker` | `Dockerode` | `new Docker()` | The client (`DOCKER_HOST` or `/var/run/docker.sock`) |
| `image` | `string` | `DEFAULT_SANDBOX_IMAGE` | The workspace image; pin a digest in production |
| `network` | `string` | `'bridge'` | `'bridge'`, `'none'` or a user-created network |
| `pull` | `'missing' \| 'always' \| 'never'` | `'missing'` | When to pull an image (every image, also one a run asked for) |
| `env` | `Record<string, string>` | none | Added after `SANDBOX_ENV` and `CACHE_ENV` |
| `limits` | `SandboxLimits` | `DEFAULT_LIMITS` | `cpu`, `memory`, `pids`, `maxLifetimeMs` (`storage` is not enforced) |
| `user` | `string` | `'0:0'` | The container user (`uid:gid` or a name); a non-root user gets no capability |
| `readOnlyRoot` | `boolean` | `false` | A read-only root filesystem |
| `cache` | `{ volume: string }` | none (an anonymous volume per workspace) | A named `/cache` volume shared by every workspace (`false` and `{}` are refused) |
| `tmpSize` | `string` | `'1Gi'` | Size of the `/tmp` tmpfs |
| `clock` | `IClock` | `systemClock` | Expiry and the exec guard |

Misconfiguration throws core `InvalidAgentDefinitionError`; daemon and container failures are `SandboxError`s.

## API

| Export | Kind | Purpose |
|---|---|---|
| `createDockerSandbox` | function | The `ISandboxProvider` (`name: 'docker'`) |
| `DEFAULT_NETWORK` | constant | `'bridge'` |
| `CONTAINER_NAME_PREFIX` | constant | `'chamvi-ws-'` |
| `DEFAULT_USER` | constant | `'0:0'` |

Types: `DockerSandboxOptions`.

## License

Published under [Apache License 2.0](./LICENSE).
