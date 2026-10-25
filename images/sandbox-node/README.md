# sandbox-node

> **Deprecated.** `ghcr.io/chamvi/sandbox-dev` ([`images/sandbox-dev`](../sandbox-dev/README.md)) is the default workspace image now: any toolchain through mise, root by default. `sandbox-node` keeps building for one release, then goes. To keep using it, pass `image: 'ghcr.io/chamvi/sandbox-node:24'` to the provider (it runs as root there too, or as uid 1000 with `user: '1000:1000'` and `readOnlyRoot: true` on Docker, `user: { uid: 1000, gid: 1000 }` on Kubernetes).

The former default workspace image of chamvi's container sandboxes (`@chamvi/sandbox-docker`, `@chamvi/sandbox-k8s`): `ghcr.io/chamvi/sandbox-node`.

## What is inside

- `node:24-trixie-slim` (Node.js 24, npm, corepack)
- `git`, `ca-certificates`
- `tini` as the entrypoint (pid 1 reaps orphaned processes and forwards signals)
- GNU coreutils `timeout`, which the providers wrap every command in
- `/workspace`, owned by uid 1000, the working directory
- `USER 1000:1000` (the image's `node` user), which the providers' `user` option overrides; the command is `sleep infinity`

In the providers' hardened mode the container has a read-only root filesystem, no capabilities, `no-new-privileges`, pid, memory and cpu limits, a `/tmp` tmpfs and volumes at `/workspace` and `/cache`.

## Environment

The image sets the sandbox environment of `@chamvi/sandbox` (`SANDBOX_ENV`), so a container started without the providers behaves the same:

| Variable | Value | Why |
|----------|-------|-----|
| `HOME` | `/tmp` | The root filesystem is read-only. |
| `GIT_TERMINAL_PROMPT` | `0` | git never waits for credentials. |
| `GIT_CONFIG_NOSYSTEM` | `1` | No system gitconfig (credential helpers). |
| `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0` | `1`, `safe.directory`, `/workspace` | A volume may be root-owned; git would refuse it as "dubious ownership". |
| `NPM_CONFIG_UPDATE_NOTIFIER` | `false` | No update check. |
| `CI` | `true` | Non-interactive tools. |
| `NPM_CONFIG_CACHE` | `/tmp/.npm` | npm cache on the writable tmpfs. |
| `NPM_CONFIG_PREFIX` | `/tmp/.npm-global` | `npm install -g` works without root; its `bin` is first on `PATH`. |
| `COREPACK_HOME` | `/tmp/.corepack` | `pnpm` and `yarn` through corepack. |

No secrets, tokens or credentials are baked in or passed to a workspace.

## Tags

Built for `linux/amd64` and `linux/arm64` by `.github/workflows/images.yml`:

- `24`: the latest build, rebuilt on every change under `images/` on `master` and weekly (base image security updates)
- `24-<short sha>`: one tag per commit on `master` that changes the image, pushed once with that commit; the weekly and manual rebuilds move only `24`

Pin a digest (`ghcr.io/chamvi/sandbox-node@sha256:...`) in production, or use `pull: 'always'` (Docker) / `imagePullPolicy: 'Always'` (Kubernetes) to follow the mutable `24` tag.

## Extending it

Build your own image on top and pass it as `image` to the provider. Keep uid 1000, the entrypoint and `/workspace`, and install system packages as root before switching back:

```dockerfile
FROM ghcr.io/chamvi/sandbox-node:24

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000
```

The providers need `sh`, `cat`, `head`, `mkdir`, `dirname`, `cp`, `mv`, `rm`, GNU `timeout` and `git` in the image.

## Building locally

```bash
docker build -t chamvi/sandbox-node:dev images/sandbox-node
docker run --rm chamvi/sandbox-node:dev sh -c 'node --version && git --version && id -u'
```
