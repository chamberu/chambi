/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Characters of a structured-output parse or schema error kept in `run.error.message`. */
export const MAX_ERROR_CAUSE_LENGTH = 500;

/**
 * How long a finished execution waits for its conversation-bound emits still
 * in flight (a tool that did not await one) before it aborts them: an aborted
 * send stays `pending` and terminal reconciliation marks it `unknown`.
 */
export const CONVERSATION_SEND_GRACE_MS = 30_000;
