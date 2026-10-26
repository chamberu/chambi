/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Network of a workspace container unless configured. */
export const DEFAULT_NETWORK = 'bridge';

/** A workspace container is named `chamvi-ws-<workspace id>`. */
export const CONTAINER_NAME_PREFIX = 'chamvi-ws-';

/**
 * The user of a workspace container and its commands: root, so `apt` and
 * every package manager work (the container is the boundary; `user` and
 * `readOnlyRoot` restore the hardened mode).
 */
export const DEFAULT_USER = '0:0';

/**
 * The user of the one exec that opens the cache to a non-root `user`
 * (`openCache`): root owns the mount point Docker makes for an image
 * without `/cache` and the top-level folders a root workspace made in a
 * shared volume (`cache.volume`), and an owner changes a mode without any capability.
 */
export const CACHE_OPEN_USER = '0:0';

/** How long opening the cache of a create may take. */
export const CACHE_OPEN_TIMEOUT_MS = 30_000;

/**
 * The command of a workspace container (`sh -c` with the deadline, epoch
 * seconds, as `$1`): it sleeps until the workspace's `expiresAt`, also when
 * `find` starts the container again after a host or daemon restart, and
 * exits at once past it. An absolute deadline, since a fixed `sleep
 * <lifetime>` would start over on every restart.
 */
export const SLEEP_UNTIL_SCRIPT = 'd=$(( $1 - $(date +%s) )); if [ "$d" -gt 0 ]; then exec sleep "$d"; fi';
