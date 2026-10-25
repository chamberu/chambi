# sandbox-dev

The default workspace image of chamvi's container sandboxes (`@chamvi/sandbox-docker`, `@chamvi/sandbox-k8s`): `ghcr.io/chamvi/sandbox-dev`. It replaces `sandbox-node`, which keeps building for one deprecation window.

## What is inside

- `debian:trixie-slim`
- `git`, `ca-certificates`, `curl`, `jq`, `ripgrep`, `unzip`, `xz-utils`
- `build-essential` (gcc, make, libc headers), so native packages compile
- [mise](https://mise.jdx.dev) from its apt repository, with its shims (in the workspace's HOME `/home/sandbox`, per workspace, on disk) at the end of the `PATH`
- `tini` as the entrypoint (pid 1 reaps orphaned processes and forwards signals)
- GNU coreutils `timeout`, which the providers wrap every command in
- `/workspace` (the working directory) and `/cache` (the package cache), writable by any user
- root by default; the command is `sleep infinity`

No language toolchain is baked in. A workspace installs what the repository needs at runtime:

```bash
mise use -g node@22        # node, npm and npx on the PATH through mise's shims
mise install               # whatever .tool-versions, mise.toml, .nvmrc or .python-version name
apt-get update && apt-get install -y --no-install-recommends libpq-dev
```

Toolchains land in `/cache/mise`, which the providers mount as a cache volume shared by every workspace of a host (Docker) or a claim (Kubernetes), so a second run finds `node@22` installed.

The providers run the container as root with a writable root filesystem and only the capabilities package managers need (`CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `FSETID`, `SETUID`, `SETGID`, `KILL`), `no-new-privileges`, pid, memory and cpu limits, a 1 GiB `/tmp` tmpfs and volumes at `/workspace`, `/home/sandbox` (HOME) and `/cache`. Their `user` and `readOnlyRoot` options restore the hardened mode (uid 1000, read-only root, no capability), which this image supports too.

## Environment

| Variable | Value | Why |
|----------|-------|-----|
| `DEBIAN_FRONTEND` | `noninteractive` | `apt-get install` never asks. |
| `CI` | `true` | Non-interactive tools. |
| `GIT_TERMINAL_PROMPT` | `0` | git never waits for credentials. |
| `MISE_DATA_DIR` | `/cache/mise` | Toolchains in the shared cache. |
| `MISE_SHIMS_DIR` | `/home/sandbox/.local/share/mise/shims` | Shims per workspace in its HOME volume (kept across a restart), never in the shared cache, where any run could plant a `git`, nor in the memory-backed `/tmp`. |
| `MISE_YES` | `1` | mise never asks. |
| `MISE_TRUSTED_CONFIG_PATHS` | `/workspace` | mise reads the repository's `mise.toml` without a trust prompt. |
| `MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS` | `node,python,ruby,go,java` | mise reads `.nvmrc`, `.python-version` and friends. |
| `PATH` | `...:/home/sandbox/.local/share/mise/shims` | Installed tools are plain commands; the system's `sh`, `git` and `timeout` come first. |

The providers add `SANDBOX_ENV` and the cache variables of `@chamvi/sandbox` (`CACHE_ENV`: `XDG_CACHE_HOME`, `npm_config_cache`, `PIP_CACHE_DIR`, `GOMODCACHE`, `GOCACHE`, `COMPOSER_CACHE_DIR`, `MISE_DATA_DIR`, all under `/cache`). No secrets, tokens or credentials are baked in or passed to a workspace.

## Any image

A run may ask for another image (`create_workspace({ image })`, narrowed by the manager's `allowImage`). The providers need `sh`, `git` and a GNU `timeout` that takes `-k` in it, plus `cat`, `head`, `mkdir`, `dirname`, `cp`, `mv` and `rm`; `create` probes the first three and fails with a message naming what is missing, before any checkout.

## Tags

Built for `linux/amd64` and `linux/arm64` by `.github/workflows/images.yml`:

- `trixie`: the latest build, rebuilt on every change under `images/` on `master` and weekly (Debian security updates, a new mise)
- `trixie-<short sha>`: one tag per commit on `master` that changes the image, pushed once with that commit; the weekly and manual rebuilds move only `trixie`

Pin a digest (`ghcr.io/chamvi/sandbox-dev@sha256:...`) in production, or use `pull: 'always'` (Docker) / `imagePullPolicy: 'Always'` (Kubernetes) to follow the mutable tag.

## Building locally

```bash
docker build -t chamvi/sandbox-dev:dev images/sandbox-dev
docker run --rm chamvi/sandbox-dev:dev sh -c 'git --version && mise --version && rg --version && id -u'
```
