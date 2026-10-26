/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type WebFetchFormat = 'markdown' | 'text' | 'raw';

export type WebFetchResult = {
    /** The URL after redirects. */
    url: string;
    status: number;
    contentType: string | null;
    format: WebFetchFormat;
    title?: string;
    /** At most `WEB_FETCH_MAX_CHARS` characters from `offset`. */
    content: string;
    offset: number;
    /** Characters of the whole (converted) document. */
    totalChars: number;
    /** The offset of the next page, when the content goes on. */
    nextOffset?: number;
    /** The body was longer than `maxBytes` and was cut. */
    truncated: boolean;
};
