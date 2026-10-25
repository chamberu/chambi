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

/** The package-cache variables, each a folder under the cache directory. */
export const CACHE_FOLDERS: Readonly<Record<string, string>> = Object.freeze({
    XDG_CACHE_HOME: 'xdg',
    npm_config_cache: 'npm',
    PIP_CACHE_DIR: 'pip',
    GOMODCACHE: 'go/mod',
    GOCACHE: 'go/build',
    CARGO_HOME: 'cargo',
    COMPOSER_CACHE_DIR: 'composer',
    MISE_DATA_DIR: 'mise',
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

/** What a workspace image must provide: a shell, git and a `timeout` that takes `-k`. */
export const IMAGE_REQUIREMENTS: readonly string[] = Object.freeze(['sh', 'git', 'timeout']);

/** How long the image probe of a create may take. */
export const IMAGE_PROBE_TIMEOUT_MS = 30_000;

/** The exit status of the probe script when something is missing (the names on stdout). */
export const IMAGE_PROBE_MISSING_EXIT = 3;

/**
 * Prints what the image lacks (`git`, `timeout`, or `timeout-k` for a
 * `timeout` without `-k`, like an old busybox) and exits
 * `IMAGE_PROBE_MISSING_EXIT` then, else 0.
 */
export const IMAGE_PROBE_SCRIPT = [
    'm=',
    'command -v git >/dev/null 2>&1 || m="$m git"',
    'if ! command -v timeout >/dev/null 2>&1; then m="$m timeout"; ' +
    'elif ! timeout -k 1 5 true >/dev/null 2>&1; then m="$m timeout-k"; fi',
    `if [ -n "$m" ]; then printf '%s\\n' "$m"; exit ${IMAGE_PROBE_MISSING_EXIT}; fi`,
].join('\n');
