/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * An image reference as Docker and Kubernetes take it: registry, path,
 * tag and digest characters only, starting with a letter or digit, at
 * most 255 characters.
 */
export const IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/:@+]{0,254}$/;

/** Where a container or pod workspace mounts its package cache. */
export const CACHE_DIR = '/cache';

/**
 * Drops every `PATH` entry at or under `CACHE_DIR` before chamvi's own
 * commands run (the image probe, the `timeout` wrapper of every exec, the
 * checkout's `git`): the cache may be shared by several runs and agents
 * (a named Docker volume, a cache claim) and is writable by each, so a `git`
 * or `timeout` one run planted there must never
 * be what another run's workspace executes. A PATH without such an entry
 * stays as it is. One line, no trailing `;`.
 */
export const PATH_GUARD_SCRIPT = [
    `case ":$PATH:" in *:${CACHE_DIR}:*|*:${CACHE_DIR}/*)`,
    'p=; IFS=:; set -f;',
    `for d in $PATH; do case $d in ${CACHE_DIR}|${CACHE_DIR}/*) ;; *) p=\${p:+$p:}$d;; esac; done;`,
    'set +f; unset IFS; PATH=$p; export PATH;; esac',
].join(' ');

/**
 * The package-cache variables, each a folder under the cache directory.
 * Only package download caches: no home of a tool that keeps credentials
 * or installed programs there (`CARGO_HOME` holds `credentials.toml` and
 * `cargo install`ed binaries, so cargo keeps its home, `$HOME/.cargo`, per
 * workspace; mise keeps its toolchains in its default
 * `$HOME/.local/share/mise`, per workspace too).
 */
export const CACHE_FOLDERS: Readonly<Record<string, string>> = Object.freeze({
    XDG_CACHE_HOME: 'xdg',
    npm_config_cache: 'npm',
    PIP_CACHE_DIR: 'pip',
    GOMODCACHE: 'go/mod',
    GOCACHE: 'go/build',
    COMPOSER_CACHE_DIR: 'composer',
});

/** The cache variables of a container or pod workspace, all under `CACHE_DIR`. */
export const CACHE_ENV: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(CACHE_FOLDERS)
    .map(([key, folder]) => [key, `${CACHE_DIR}/${folder}`])));

/**
 * The capabilities a root workspace keeps (all others are dropped): what
 * package managers need to unpack, chown and switch users (`apt`'s `_apt`
 * sandbox), and to signal their own processes.
 */
export const ROOT_CAPABILITIES: readonly string[] = Object.freeze([
    'CHOWN',
    'DAC_OVERRIDE',
    'FOWNER',
    'FSETID',
    'SETUID',
    'SETGID',
    'KILL',
]);

/**
 * What a workspace image must provide: a shell (also at `/bin/sh`), git, a
 * `timeout` that takes `-k`, and `head`, `base64` and `tr` in `/usr/bin` or
 * `/bin` (the repository guidance collector resolves them nowhere else).
 */
export const IMAGE_REQUIREMENTS: readonly string[] = Object.freeze(['sh', 'git', 'timeout', 'head', 'base64', 'tr']);

/** How long the image probe of a create may take. */
export const IMAGE_PROBE_TIMEOUT_MS = 30_000;

/** The exit status of the probe script when something is missing (the names on stdout). */
export const IMAGE_PROBE_MISSING_EXIT = 3;

/**
 * Prints what the image lacks (`git`, `timeout`, or `timeout-k` for a
 * `timeout` without `-k`, like an old busybox; `/bin/sh` and the `head`,
 * `base64` and `tr` the repository guidance collector resolves on
 * `/usr/bin:/bin` only) and exits `IMAGE_PROBE_MISSING_EXIT` then, else 0.
 */
export const IMAGE_PROBE_SCRIPT = [
    PATH_GUARD_SCRIPT,
    'm=',
    'command -v git >/dev/null 2>&1 || m="$m git"',
    '[ -x /bin/sh ] || m="$m /bin/sh"',
    'for u in head base64 tr; do (PATH=/usr/bin:/bin; command -v "$u") >/dev/null 2>&1 || m="$m $u"; done',
    'if ! command -v timeout >/dev/null 2>&1; then m="$m timeout"; ' +
    'elif ! timeout -k 1 5 true >/dev/null 2>&1; then m="$m timeout-k"; fi',
    `if [ -n "$m" ]; then printf '%s\\n' "$m"; exit ${IMAGE_PROBE_MISSING_EXIT}; fi`,
].join('\n');
