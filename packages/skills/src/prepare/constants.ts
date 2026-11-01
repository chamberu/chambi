/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The code of a retryable preparation failure (the source could not be fetched, the managed directory not written). */
export const SKILL_PREPARATION_FAILED_ERROR_CODE = 'skill_preparation_failed';

/** The code of a preparation refused because another preparer holds the target's guard (the message names it). */
export const SKILL_PREPARATION_LOCKED_ERROR_CODE = 'skill_preparation_locked';

/**
 * The age at which a target's guard counts as stale whoever holds it (1 h,
 * well above the SDK's default 5 min clone timeout). A guard of a process
 * on this host that no longer runs is stale at once.
 */
export const SKILL_PREPARATION_LOCK_STALE_MS = 3_600_000;
