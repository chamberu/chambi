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

/** The named volume every workspace mounts at `/cache` unless `cache` says otherwise. */
export const DEFAULT_CACHE_VOLUME = 'chamvi-sandbox-cache';
