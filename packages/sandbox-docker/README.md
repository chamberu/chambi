<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/sandbox-docker" width="128" height="128" />
</p>

<h1 align="center">@chamvi/sandbox-docker</h1>

<p align="center">
    <b>One hardened container per workspace, for chamvi agents on a Docker host.</b><br>
    uid 1000, a read-only root, no capabilities, <code>no-new-privileges</code>, cpu, memory and pid limits,<br>
    and every command inside GNU <code>timeout</code>: real isolation without a cluster.
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
| User | `1000:1000` (`SANDBOX_USER`) |
| Command | `sleep infinity`: the lifetime follows the run; the garbage collection removes it |
| Root filesystem | read-only (`ReadonlyRootfs`) |
| Capabilities | all dropped, `no-new-privileges:true`, not privileged |
| Limits | `NanoCpus` from `cpu`, `Memory` and `MemorySwap` (no swap) from `memory`, `PidsLimit` from `pids` |
| `/workspace` | an anonymous volume, removed with the container (`remove({ force: true, v: true })`) |
| `/tmp` | a 512 MiB tmpfs (`exec`, `nosuid`, `nodev`): npm's global prefix and cache and corepack live there, as in a Kubernetes pod's memory `emptyDir` |
| Network | `network` (default `bridge`) |
| Environment | `SANDBOX_ENV` plus `env`, nothing from the host |
| Labels | `app.kubernetes.io/managed-by=chamvi`, `app.kubernetes.io/component=sandbox`, `chamvi.dev/run=<runId>`, `chamvi.dev/workspace=<id>`, `chamvi.dev/deployment=<deployment>`, `chamvi.dev/repo-key=<hash>` (with a repository), `chamvi.dev/created-at` and `chamvi.dev/expires-at` (epoch ms), `chamvi.dev/repo`, `chamvi.dev/ref`, `chamvi.dev/image` |

`limits.storage` is not enforced: a default volume has no size (use a storage driver with quotas, or the Kubernetes provider). Commands run through the Docker exec API in `/workspace`; a file is read with `cat` and written with `head -c` from stdin.

## Image

The default image is `ghcr.io/chamvi/sandbox-node:24` (`DEFAULT_SANDBOX_IMAGE`): Node.js 24, npm, corepack, git, `tini` and GNU coreutils, built for `linux/amd64` and `linux/arm64` from [`images/sandbox-node`](../../images/sandbox-node). Tags: `24` (rebuilt on changes and weekly for base image updates) and `24-<short sha>` (pushed once per commit that changes the image).

- `pull: 'missing'` (default) pulls the image once when the daemon lacks it, `'always'` before every create (a mutable tag such as `:24` then follows its rebuilds), `'never'` never.
- Pin a digest in production (`image: 'ghcr.io/chamvi/sandbox-node@sha256:...'`), or use `pull: 'always'`.
- Your own image works when it keeps uid 1000, `/workspace`, and has `sh`, `cat`, `head`, `mkdir`, `dirname`, `cp`, `mv`, `rm`, GNU `timeout` and `git`.

## Security

- **Socket access is root on the host.** Whoever can talk to the Docker socket can start a privileged container. Give the chamvi process a [socket proxy](https://github.com/Tecnativa/docker-socket-proxy) that allows only containers, exec and images, or run [rootless Docker](https://docs.docker.com/engine/security/rootless/), rather than mounting `/var/run/docker.sock` into it.
- **Not a network boundary.** On `bridge` a workspace reaches the host gateway (the chamvi API, Postgres, an MCP server), other containers and cloud metadata at `169.254.169.254`. Use a dedicated network without inter-container traffic and firewall it:

  ```bash
  docker network create --opt com.docker.network.bridge.enable_icc=false chamvi-sandbox
  # then drop traffic from that bridge to the host gateway and 169.254.169.254 (iptables DOCKER-USER chain)
  ```

  and pass `network: 'chamvi-sandbox'`. `network: 'none'` cuts the network entirely; then only repo-less workspaces work, since the clone runs inside the container.
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
| `pull` | `'missing' \| 'always' \| 'never'` | `'missing'` | When to pull the image |
| `env` | `Record<string, string>` | none | Added after `SANDBOX_ENV` |
| `limits` | `SandboxLimits` | `DEFAULT_LIMITS` | `cpu`, `memory`, `pids`, `maxLifetimeMs` (`storage` is not enforced) |
| `clock` | `IClock` | `systemClock` | Expiry and the exec guard |

Misconfiguration throws core `InvalidAgentDefinitionError`; daemon and container failures are `SandboxError`s.

## API

| Export | Kind | Purpose |
|---|---|---|
| `createDockerSandbox` | function | The `ISandboxProvider` (`name: 'docker'`) |
| `DEFAULT_NETWORK` | constant | `'bridge'` |
| `CONTAINER_NAME_PREFIX` | constant | `'chamvi-ws-'` |
| `SANDBOX_USER` | constant | `'1000:1000'` |

Types: `DockerSandboxOptions`.

## License

Published under [Apache License 2.0](./LICENSE).
