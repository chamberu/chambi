/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The `code` of a failed web request handed to the model as a tool error. */
export const WEB_REQUEST_ERROR_CODE = 'web_request';

/** Redirects one request follows at most. */
export const MAX_REDIRECTS = 5;

/** The default timeout of one request, redirects and body included. */
export const WEB_TIMEOUT_MS = 30_000;

/** The default number of bytes `web_fetch` reads of a response (5 MiB). */
export const WEB_FETCH_MAX_BYTES = 5_242_880;

/** The `user-agent` of every request. */
export const USER_AGENT = 'chamvi-tool-web (+https://chamvi.dev)';

/** The redirect statuses followed by hand. */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
