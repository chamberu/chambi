# Docker Image <Badge type="warning" text="Planned" />

::: warning Planned
The template repository does not exist yet. The [base image](#base-image), the [`chamvi build`](/reference/cli#build-output) command and the [sandbox image](#sandbox-image) do.
:::

## Base image

Agent images build their runtime stage on `ghcr.io/chamvi/node`, built from [`images/node`](https://github.com/chamvi/chamvi/tree/master/images/node).

- **Contents:** `node:24-trixie-slim` (Node.js 24, npm, corepack), ca-certificates, `tini` as the entrypoint (signals reach Node, orphaned processes are reaped), `NODE_ENV=production`, `WORKDIR /app` owned by root (the app reads its code, never writes it), `USER 1000:1000` (numeric, so Kubernetes `runAsNonRoot` can verify it); the default command is `node`. The shell stays for `kubectl exec`. No git and no compiler: build native addons in a `node:24-trixie-slim` build stage (same Debian 13 glibc).
- **Platforms:** `linux/amd64` and `linux/arm64`.
- **Tags:** `24`, rebuilt on every push to `master` that changes anything under `images/` (or the workflow), weekly for base image security updates and on manual runs, and `24-<short sha>`, one tag per such push to `master` (the weekly and manual rebuilds move only `24`). Pull requests that touch the image build and smoke-test it without pushing.
- **Pinning:** reference a digest in production (`FROM ghcr.io/chamvi/node:24@sha256:...`).
- **Workspaces:** without git the image cannot host `@chamvi/sandbox-local` workspaces; in a cluster, run them with `@chamvi/sandbox-k8s` and the [sandbox image](#sandbox-image).

## Agent images

Agent repositories use a two-stage Dockerfile from the template:

1. **Build stage:** install dependencies and bundle the app entry with `chamvi build`.
2. **Runtime stage:** copy the bundle onto the base image and start it with an exec-form `CMD`, so `SIGTERM` reaches Node (forwarded by the base image's tini) and the engine can [drain](/guide/recovery#drain).

The same image serves every mode: the long-running app, and a one-shot `chamvi run-job <agent> [subscriptionId]` (the agent's only cron subscription by default) for clusters that prefer Kubernetes CronJobs over in-process scheduling.

## Tags for Flux

The template's CI pushes images tagged `main-<sha>-<unix timestamp>` for every push to the main branch, plus semver tags for releases. Flux image automation picks the newest tag and updates the `HelmRelease`. See [Kubernetes & Flux](/deployment/kubernetes).

## Sandbox image

Agents that run untrusted code (reproducing a bug, running tests, fixing a dependency bump) do it in [workspaces](/guide/workspaces) from a separate image, `ghcr.io/chamvi/sandbox-dev`, built from [`images/sandbox-dev`](https://github.com/chamvi/chamvi/tree/master/images/sandbox-dev). It runs as its own container (`@chamvi/sandbox-docker`) or pod (`@chamvi/sandbox-k8s`), never inside the agent's container.

- **Contents:** `debian:trixie-slim`, git, ca-certificates, curl, ripgrep, jq, build-essential, unzip, `tini` as the entrypoint, GNU coreutils `timeout`, and [mise](https://mise.jdx.dev) with its shims (in the workspace's HOME `/home/sandbox`, per workspace, on disk) at the end of the `PATH`; root by default, `/workspace` and `/cache` writable by any user. No language toolchain: a workspace installs one with `mise use -g node@22` (or `mise install` from the repository's version files) into `/cache/mise`, the shared cache.
- **Platforms:** `linux/amd64` and `linux/arm64`.
- **Tags:** `trixie`, rebuilt on every change under `images/` on `master` and weekly for Debian security updates, and `trixie-<short sha>`, one tag per push to `master` that changes the image (the weekly rebuild moves only `trixie`). Pull requests that touch the image build and smoke-test it without pushing.
- **Pinning:** reference a digest in production (`ghcr.io/chamvi/sandbox-dev@sha256:...`), or follow the mutable tag with `pull: 'always'` (Docker) or `imagePullPolicy: 'Always'` (Kubernetes).
- **Any image:** a run may pick another one (`create_workspace({ image })`, narrowed by the manager's `allowImage`), or you set `image` on the provider. It needs `sh`, `git` and a GNU `timeout` that takes `-k` (probed before the checkout), plus `cat`, `head`, `mkdir`, `dirname`, `cp`, `mv` and `rm`.
- **Deprecated:** `ghcr.io/chamvi/sandbox-node:24` (Node.js 24, uid 1000) keeps building for one release; pass it as `image` to keep it meanwhile.

On a Docker host, the agent needs access to the Docker API to start sandbox containers. That access is root on the host: give the agent a socket proxy that allows only containers, exec and images, or run rootless Docker. See [`@chamvi/sandbox-docker`](/reference/sandbox#chamvi-sandbox-docker).
