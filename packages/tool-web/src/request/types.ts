/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** A fetched page: the URL after redirects and at most `maxBytes` of its body. */
export type WebResponse = {
    url: URL;
    status: number;
    contentType: string | null;
    bytes: Uint8Array;
    truncated: boolean;
};
