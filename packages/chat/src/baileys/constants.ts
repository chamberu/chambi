/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The adapter's name: thread ids are `whatsapp:<jid>`. */
export const WHATSAPP_ADAPTER_NAME = 'whatsapp';

/**
 * Reconnect after an unexpected close: attempt n (0-based) waits
 * `min(maxMs, initialMs * factor^n)`, scaled by a random factor in
 * `1 ± jitter` and capped at `maxMs`; after `maxAttempts` failed attempts in
 * a row (an open resets the count) the connection stays disconnected.
 */
export const WHATSAPP_RECONNECT = Object.freeze({
    initialMs: 2000,
    factor: 1.8,
    maxMs: 30_000,
    jitter: 0.25,
    maxAttempts: 12,
});

/** How long stop waits for pending auth writes and the flush before it keeps the lease fenced. */
export const WHATSAPP_SHUTDOWN_TIMEOUT_MS = 30_000;

/** Auth persistence failed or did not finish in time (the lease stays fenced). */
export const WHATSAPP_AUTH_ERROR_CODE = 'whatsapp_auth';

/** The connection gave up: reconnects exhausted, or another client replaced the session. */
export const WHATSAPP_CONNECTION_ERROR_CODE = 'whatsapp_connection';

/** WhatsApp logged the device out: it needs pairing again, nothing reconnects. */
export const WHATSAPP_LOGGED_OUT_ERROR_CODE = 'whatsapp_logged_out';

/** The prefix of the message ids chamvi derives (Baileys' own ids start so too). */
export const MESSAGE_ID_PREFIX = '3EB0';
