/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** What every redaction puts in place of an issued credential. */
export const REDACTED = '[redacted]';

/**
 * The workspace credentials file is rewritten before
 * an exec once a credential in it expires within this long.
 */
export const CREDENTIAL_REFRESH_MS = 600_000;

/** After a failed credential lookup, the next exec tries again only this much later. */
export const CREDENTIAL_RETRY_MS = 60_000;

/** The workspace credentials file, below `$HOME` (mode 0600). */
export const CREDENTIALS_FILE = '.chamvi/credentials';

/** Shorter values are never redacted (they would match everywhere). */
export const REDACT_MIN_LENGTH = 4;

/**
 * How long after its `expiresAt` an issued credential stays redacted: a
 * token is worthless then, and keeping every token a long-lived process
 * ever issued would grow the redactor without bound.
 */
export const REDACT_GRACE_MS = 3_600_000;
