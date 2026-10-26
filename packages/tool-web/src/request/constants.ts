/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Bytes `web_fetch` reads of a response by default. */
export const WEB_FETCH_MAX_BYTES = 5 * 1_048_576;

/** Milliseconds one fetch may take by default, redirects included. */
export const WEB_TIMEOUT_MS = 30_000;

/** Redirects `web_fetch` follows, each checked like the first URL. */
export const WEB_MAX_REDIRECTS = 5;

/** The code of a failed request (a tool error, never fatal). */
export const WEB_REQUEST_ERROR_CODE = 'web_request';
