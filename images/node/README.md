# node

The runtime base of chamvi agent images: `ghcr.io/chamvi/node`. It is not the sandbox image; workspaces run [`sandbox-dev`](../sandbox-dev).

## What is inside

- `node:24-trixie-slim` (Node.js 24, npm, corepack, a shell)
- `ca-certificates`
- `tini` as the entrypoint (pid 1 forwards signals and reaps orphaned processes, so a Node process without a SIGTERM handler still stops)
- `NODE_ENV=production`
- `/app`, owned by root, the working directory: the app reads its code, never writes it
- `USER 1000:1000`, numeric (the image's `node` user), so Kubernetes `runAsNonRoot` can verify it; the default command is `node`

No git and no compiler. Build native addons in a `node:24-trixie-slim` build stage, which has the same Debian 13 glibc.

## Running it

The image itself has a writable root filesystem. Under the Helm chart (a read-only root filesystem and an emptyDir at `/tmp`) the app writes only to `/tmp`; `HOME` (`/home/node`, from `/etc/passwd`) is not writable either.

A typical runtime stage installs nothing and copies the build stage's output into `/app`, root-owned (no `--chown`), then sets an exec-form `CMD` of the app's own entry (tini stays the entrypoint):

```dockerfile
FROM ghcr.io/chamvi/node:24@sha256:...

COPY package.json ./
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/

CMD ["node", "dist/index.mjs"]
```

`NODE_ENV=production` makes `npm ci` and `npm install` skip devDependencies. Do not install in this image: install in the build stage and copy `node_modules/` over.

## Tags

Built for `linux/amd64` and `linux/arm64` by `.github/workflows/images.yml`:

- `24`: the latest build, rebuilt on every push to `master` that changes anything under `images/` (or the workflow), weekly (base image security updates) and on manual runs
- `24-<short sha>`: one tag per such push to `master`, pushed once with that commit; the weekly and manual rebuilds move only `24`

Pin a digest in production (`FROM ghcr.io/chamvi/node:24@sha256:...`); a Dependabot `docker` entry in your repository then bumps that digest.

## Extending it

Install system packages as root and switch back to uid 1000:

```dockerfile
FROM ghcr.io/chamvi/node:24

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000
```

## Building locally

```bash
docker build -t chamvi/node:dev images/node
docker run --rm chamvi/node:dev sh -c 'node --version && id -u'
```
