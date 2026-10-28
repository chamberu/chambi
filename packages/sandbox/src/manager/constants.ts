/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Default cap of workspaces one run may hold at once (pending creates included). */
export const MAX_WORKSPACES_PER_RUN = 3;

/** Default minimum interval between the garbage collections `acquire` starts. */
export const GC_INTERVAL_MS = 600_000;

/** The largest `gcIntervalMs`: a Node timer above 2^31 - 1 ms fires after 1 ms. */
export const GC_INTERVAL_MAX_MS = 2_147_483_647;

/** Default bound of `close()`: how long it waits for disposals and creates in flight. */
export const CLOSE_TIMEOUT_MS = 30_000;

/** Exec timeout of writing a workspace's git credentials file. */
export const CREDENTIAL_INSTALL_TIMEOUT_MS = 30_000;
