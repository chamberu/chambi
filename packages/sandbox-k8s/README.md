<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/sandbox-k8s" width="128" height="128" />
</p>

<h1 align="center">@chamvi/sandbox-k8s</h1>

<p align="center">
    <b>One pod per workspace, for chamvi agents on Kubernetes.</b><br>
    Root inside so package managers work, a few capabilities, no service account token, resource limits,<br>
    found again by label after a restart or on another replica.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/sandbox-k8s"><img src="https://img.shields.io/npm/v/@chamvi/sandbox-k8s" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/sandbox-k8s/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/sandbox-k8s" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [RBAC](#rbac)
- [The pod](#the-pod)
- [Image](#image)
- [Security](#security)
- [Timeouts and abort](#timeouts-and-abort)
- [Garbage collection](#garbage-collection)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/sandbox-k8s @chamvi/sandbox @chamvi/core ai --save
```

ESM only, Node.js `>=22`. `@chamvi/core` and `@chamvi/sandbox` are peer dependencies. The API server is reached through [`@kubernetes/client-node`](https://www.npmjs.com/package/@kubernetes/client-node) 2 (`CoreV1Api` and `Exec` over a WebSocket). It declares `@types/node` `^26` as a runtime dependency, so a project on older Node.js types gets a nested copy; that is harmless with `skipLibCheck`.

## Usage

```typescript
import type { KubeConfig } from '@kubernetes/client-node';
import type { ISandboxProvider } from '@chamvi/sandbox';
import { createKubernetesSandbox } from '@chamvi/sandbox-k8s';

export function createSandbox(kubeConfig: KubeConfig): ISandboxProvider {
    // one pod per workspace in this namespace; nothing is contacted before the first create()
    return createKubernetesSandbox({ namespace: 'agents', kubeConfig });
}
```

Without `kubeConfig` the provider calls `loadFromDefault()`: the in-cluster service account when chamvi runs in a pod, else `KUBECONFIG` or `~/.kube/config`. Pass the provider to `createWorkspaceManager({ provider })` from `@chamvi/sandbox`. Creating it contacts nothing; `create()` creates the pod, waits until it runs (polling every second, at most two minutes, failing fast on `ErrImagePull`, `ImagePullBackOff`, `InvalidImageName`, `CreateContainerConfigError` and `CreateContainerError`), then checks out.

## RBAC

The identity chamvi runs as needs, in the sandbox namespace only:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: chamvi-sandbox
  namespace: agents
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["create", "get", "list", "delete"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["get", "create"]
```

**Pod Security**: by default the pods run as root with a writable root filesystem and the capabilities `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `FSETID`, `SETUID`, `SETGID` and `KILL`, which the Pod Security level `baseline` admits and `restricted` refuses. Label the sandbox namespace accordingly:

```bash
kubectl label namespace agents pod-security.kubernetes.io/enforce=baseline
```

Where only `restricted` is allowed, use the hardened mode, `createKubernetesSandbox({ namespace, user: { uid: 1000, gid: 1000 }, readOnlyRoot: true })`: non-root with `runAsNonRoot` and `fsGroup`, a read-only root, no capability (`apt` then fails; toolchains still install into `/cache` with mise). A shared `cache.claimName` must honour `fsGroup` (NFS-style volume plugins ignore it) or be world-writable, else the hardened user cannot write it.

`pods/exec` needs both verbs: the client opens the exec WebSocket with a `GET`, which the API server authorizes as `get`, while servers with the WebSocket-upgrade authorization change ask for `create`. Keep the sandbox namespace apart from chamvi's own, so the pods never share a namespace with its secrets.

## The pod

Each workspace is a bare pod `chamvi-ws-<id>` with one container `sandbox`:

| Setting | Value |
|---|---|
| Pod | `restartPolicy: Never`, `automountServiceAccountToken: false`, `enableServiceLinks: false`, no `activeDeadlineSeconds` (the lifetime follows the run), `terminationGracePeriodSeconds: 5` |
| Pod security | `runAsUser`/`runAsGroup` from `user` (default 0), seccomp `RuntimeDefault`; a non-root user adds `runAsNonRoot` and `fsGroup` |
| Container security | `allowPrivilegeEscalation: false`, not privileged, `readOnlyRootFilesystem` from `readOnlyRoot` (default false), all capabilities dropped and for root `ROOT_CAPABILITIES` added back |
| Command | the image's entrypoint (`tini`) with `sleep infinity` |
| Resources | requests equal limits: `cpu`, `memory`, `ephemeral-storage` from `storage` |
| `/workspace` | an emptyDir with `sizeLimit` from `storage` |
| `/tmp` | a memory-backed emptyDir of `tmpSize` (default 1 GiB, `TMP_SIZE`) |
| `/cache` | the ReadWriteMany claim `cache.claimName`, shared by every workspace, else an emptyDir of its own |
| Environment | `SANDBOX_ENV`, the cache variables (`CACHE_ENV`) and `env`, nothing from chamvi's pod |
| Labels | `podLabels`, then `app.kubernetes.io/managed-by=chamvi`, `app.kubernetes.io/component=sandbox`, `chamvi.dev/run=<runId>`, `chamvi.dev/workspace=<id>`, `chamvi.dev/deployment=<deployment>`, `chamvi.dev/repo-key=<hash>` (with a repository) (the managed labels win; `podLabels` naming one throws; a `runId` that is no label value is a `ValidationError`, engine run ids are UUIDs) |
| Annotations | `chamvi.dev/created-at` and `chamvi.dev/expires-at` (epoch ms), `chamvi.dev/repo`, `chamvi.dev/ref`, `chamvi.dev/image` |

A pod is used rather than a Job: exec needs a pod name known at create time, and a Job's controller, retries and generated names add nothing the pod spec does not already enforce.

`limits.pids` has no per-pod field in Kubernetes: the kubelet's `podPidsLimit` applies, so set it on the nodes that run sandboxes.

## Image

The default image is `ghcr.io/chamvi/sandbox-dev:trixie` (`DEFAULT_SANDBOX_IMAGE`): Debian, git, build tools, ripgrep, jq and mise for any toolchain, built for `linux/amd64` and `linux/arm64` from [`images/sandbox-dev`](../../images/sandbox-dev); tags `trixie` (rebuilt on changes and weekly) and `trixie-<short sha>`. `imagePullPolicy` (the provider image's) defaults to `'IfNotPresent'`; use `'Always'` to follow the mutable tag, or pin a digest in production (`image: 'ghcr.io/chamvi/sandbox-dev@sha256:...'`).

A run may pick any image (`create_workspace({ image })`, narrowed by the manager's `allowImage`); one it asked for is pulled if not present, while the provider's and the manager's image follow `imagePullPolicy`. An image needs `sh`, `git` and a GNU `timeout` that takes `-k`: `create` probes them once the pod runs and fails with a `SandboxError` naming what is missing, before any checkout (and deletes the pod).

## Cache

Every pod mounts `/cache` and gets the cache variables (`CACHE_ENV`: `XDG_CACHE_HOME`, `npm_config_cache`, `PIP_CACHE_DIR`, `GOMODCACHE`, `GOCACHE`, `COMPOSER_CACHE_DIR`, `MISE_DATA_DIR`). Without `cache` that is an emptyDir of the pod (counted against its `ephemeral-storage`), so installs work but start cold every time. With `cache: { claimName }` every workspace mounts the same ReadWriteMany claim (NFS, CephFS, EFS, Azure Files), so toolchains and packages are fetched once per cluster.

**Risk**: a shared claim is shared by every run and agent of the namespace. A malicious package one run fetched can sit in another run's cache; npm verifies integrity hashes, pip, Go's build cache and others less. Keep runs that must not influence each other on different claims, or without one.

## Security

- **Not a network boundary.** Without a NetworkPolicy a workspace pod reaches every service in the cluster by DNS, the chamvi API and its database included, and cloud metadata. Select the pods by `app.kubernetes.io/component=sandbox` (or your `podLabels`) and deny all egress except what the work needs (GitHub, the npm registry), the chamvi namespace and `169.254.169.254` explicitly denied. The Helm chart will ship this policy.
- **Root inside, not on the node**: the default root user holds only the package-manager capabilities, no privilege escalation, seccomp `RuntimeDefault`, no host path and no privileged mode; the hardened mode drops root too.
- **No credentials**: no service account token is mounted, no service links are injected, and no chamvi environment variable reaches the pod.
- **Prompt injection**: what the model runs follows what it reads. Narrow `allowRepo` on the manager and put `bash` behind an approval where needed.

## Timeouts and abort

Every command runs as `timeout -k 5 <seconds> <argv>`, which signals its whole process group. A client-side guard stops waiting 15 s after the timeout and reports exit 137 with the output so far. Kubernetes sends an exec's exit status only once every process holding its output closed it, so the command reports its exit on stderr itself: one that exits while a background job it started holds its output (`node server.js & echo started`) returns about 2 s after its exit with its own exit code, and the job runs on until the pod is deleted. An abort (`signal`) **detaches**: the exec WebSocket closes, and the command runs on until its `timeout` fires or the pod is deleted. Every settled run disposes its workspaces (`manager.attach(engine)`). A dispose deletes the pod without a grace period.

Stdin is closed only on the `v5.channel.k8s.io` exec protocol (Kubernetes 1.30+); on `v4` it is written but never closed, so a command waiting for stdin EOF hangs until its timeout. `writeFile` does not depend on it (`head -c <bytes>`).

## Garbage collection

`find(runId, { deployment })` lists the run's pods by label and rebuilds the workspaces of the running ones (a pod that failed, finished or is being deleted is gone), so a run finds its workspace after a restart or on another replica. `collectGarbage({ deployment, isSettled })` lists the deployment's pods with the managed labels and deletes those past their `chamvi.dev/expires-at` annotation, those in phase `Failed` or `Succeeded` and, with `isSettled`, those of settled runs (open workspaces of this process are disposed first). The manager calls it from `acquire` at most every 10 minutes; it is the only reaper. A pod that cannot be removed does not stop the pass: the others go, and one `SandboxError` with the count and the first failure is thrown at the end.

## Options

`createKubernetesSandbox(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `namespace` | `string` | required | Namespace of the workspace pods |
| `kubeConfig` | `KubeConfig` | `loadFromDefault()` | Cluster access |
| `image` | `string` | `DEFAULT_SANDBOX_IMAGE` | The workspace image; pin a digest in production |
| `imagePullPolicy` | `'IfNotPresent' \| 'Always'` | `'IfNotPresent'` | Of the provider's image; `'Always'` for a mutable tag |
| `env` | `Record<string, string>` | none | Added after `SANDBOX_ENV` and `CACHE_ENV` |
| `user` | `{ uid, gid }` | `{ uid: 0, gid: 0 }` | The pod's user; a non-root user gets no capability, `runAsNonRoot` and `fsGroup` |
| `readOnlyRoot` | `boolean` | `false` | A read-only root filesystem |
| `cache` | `{ claimName }` | none | A ReadWriteMany claim shared at `/cache` (else an emptyDir per pod) |
| `tmpSize` | `string` | `'1Gi'` | Size of the in-memory `/tmp` |
| `limits` | `SandboxLimits` | `DEFAULT_LIMITS` | `cpu`, `memory`, `storage`, `maxLifetimeMs` (`pids`: see above) |
| `podLabels` | `Record<string, string>` | none | Extra labels, e.g. for a NetworkPolicy; may not name a managed label |
| `startTimeoutMs` | `number` | `120_000` | How long `create` waits for the pod to run |
| `pollMs` | `number` | `1_000` | Status poll interval while it waits |
| `clock` | `IClock` | `systemClock` | Polls, expiry and the exec guard |
| `client` | `IPodClient` | `createPodClient()` | Test seam |

Misconfiguration throws core `InvalidAgentDefinitionError`; API and pod failures are `SandboxError`s.

## API

| Export | Kind | Purpose |
|---|---|---|
| `createKubernetesSandbox` | function | The `ISandboxProvider` (`name: 'k8s'`) |
| `createPodClient` | function | The `IPodClient` over `@kubernetes/client-node` |
| `CONTAINER_NAME` | constant | `'sandbox'` |
| `POD_NAME_PREFIX` | constant | `'chamvi-ws-'` |
| `START_TIMEOUT_MS`, `POLL_MS` | constant | `120_000`, `1_000` |
| `FATAL_WAITING_REASONS` | constant | The container waiting reasons `create` fails on at once |

Types: `KubernetesSandboxOptions`, `PodUser`, `IPodClient`, `PodExecInput`, `CreatePodClientInput`.

## License

Published under [Apache License 2.0](./LICENSE).
