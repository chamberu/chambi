/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Longest `approvalId` `POST /runs/:id/approve` reads. */
export const APPROVAL_ID_MAX_LENGTH = 255;

/** Longest approval `reason`. */
export const APPROVAL_REASON_MAX_LENGTH = 1_000;

/** Most attachments one `POST /agents/:name/runs` takes; their size stays bounded by `bodyLimit`. */
export const MAX_ATTACHMENTS = 16;

/** Longest attachment `filename`. */
export const ATTACHMENT_FILENAME_MAX_LENGTH = 255;

/** The longest option id a body may select (core's `APPROVAL_OPTION_ID_PATTERN` allows 128). */
export const APPROVAL_OPTION_ID_MAX_LENGTH = 128;
