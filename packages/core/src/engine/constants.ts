/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
export const APPROVAL_TIMED_OUT = 'approval timed out';
/** TTL of the registry lock `agents:<name>`; also how long putAgent/removeAgent wait for it. */
export const AGENT_LOCK_TTL_MS = 300_000;
/** How many characters of a revision hash a cancel reason names. */
export const REVISION_PREFIX_LENGTH = 12;
