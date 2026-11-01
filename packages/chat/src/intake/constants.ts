/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ErrorCode } from '@chamvi/core';

/** The waits before the second and the third attempt of a message whose dispatch failed transiently. */
export const CHAT_INTAKE_RETRY_DELAYS_MS: readonly number[] = [1000, 2000];

/** The longest platform id (message, author) a message may carry. */
export const CHAT_ID_MAX_LENGTH = 1024;

/** Error codes a retry cannot change: reported once, never retried. */
export const TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set([
    ErrorCode.VALIDATION,
    ErrorCode.INVALID_AGENT_DEFINITION,
    ErrorCode.AGENT_NOT_FOUND,
]);
