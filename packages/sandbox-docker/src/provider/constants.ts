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
 * The named volume every root workspace mounts at `/cache` unless `cache`
 * says otherwise; a non-root `user` gets `<DEFAULT_CACHE_VOLUME>-<user>`.
 */
export const DEFAULT_CACHE_VOLUME = 'chamvi-sandbox-cache';

/**
 * The user of the one exec that opens the cache to a non-root `user`
 * (`openCache`): root owns the mount point Docker makes for an image
 * without `/cache` and the top-level folders a root workspace made in a
 * shared volume, and an owner changes a mode without any capability.
 */
export const CACHE_OPEN_USER = '0:0';

/** How long opening the cache of a create may take. */
export const CACHE_OPEN_TIMEOUT_MS = 30_000;
