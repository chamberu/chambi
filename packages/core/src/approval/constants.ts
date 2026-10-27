/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** How long an approval waits before it is denied, unless approve() names a `timeoutMs`. */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** The longest `timeoutMs` approve() takes (a larger Node timer fires after 1 ms). */
export const APPROVAL_TIMEOUT_MAX_MS = 2 ** 31 - 1;

/** The most options an approval request may offer (at least one). */
export const APPROVAL_OPTIONS_MAX = 20;

/** An option id: at most 128 characters, no whitespace (rule names, versions, branch names). */
export const APPROVAL_OPTION_ID_PATTERN = /^[A-Za-z0-9@][\w.:/@+-]{0,127}$/;

/** The longest option label (one line, not blank). */
export const APPROVAL_OPTION_LABEL_MAX_LENGTH = 200;

/** The longest detail of one option. */
export const APPROVAL_OPTION_DETAIL_MAX_LENGTH = 20_000;

/** The longest details of all options of one request together. */
export const APPROVAL_OPTIONS_DETAIL_MAX_LENGTH = 100_000;

/** The placeholder a suspended tool call resolves with; it never reaches a checkpoint. */
export const SUSPENDED_RESULT = Object.freeze({ suspended: 'approval' });
