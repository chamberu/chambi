/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { RATE_LIMIT_BACKOFF_MS } from './constants.ts';
import { ApiError } from './error.ts';
import type { PageQuery, RunListFilter } from './types.ts';

/** The `GET /runs` query, always newest first. */
export function runListQuery(filter: RunListFilter): URLSearchParams {
    const query = new URLSearchParams();

    if (filter.agent) {
        query.set('filter[agent]', filter.agent);
    }

    if (filter.status && filter.status.length > 0) {
        query.set('filter[status]', filter.status.join(','));
    }

    pageQuery(query, filter);
    query.set('sort', '-createdAt');

    return query;
}

export function pageQuery(query: URLSearchParams, page: PageQuery = {}): URLSearchParams {
    if (page.limit !== undefined) {
        query.set('page[limit]', String(page.limit));
    }

    if (page.offset !== undefined) {
        query.set('page[offset]', String(page.offset));
    }

    return query;
}

export function withQuery(path: string, query: URLSearchParams): string {
    const text = query.toString();

    return text ? `${path}?${text}` : path;
}

/** `/a/b` from the segments, each `encodeURIComponent`-ed. */
export function path(...segments: string[]): string {
    return segments.map((segment) => `/${encodeURIComponent(segment)}`).join('');
}

function retryAfterOf(response: Response): number | undefined {
    const value = Number(response.headers.get('retry-after'));

    return Number.isFinite(value) && value >= 0 && response.headers.has('retry-after') ? value : undefined;
}

/** The ApiError of a non-2xx answer; reads (and so consumes) the body. */
export async function toApiError(response: Response): Promise<ApiError> {
    let body: unknown;

    try {
        body = JSON.parse(await response.text());
    } catch {
        body = undefined;
    }

    const retryAfter = retryAfterOf(response);

    if (isObject(body) && typeof body.code === 'string') {
        return new ApiError(response.status, body.code, typeof body.message === 'string' ? body.message : response.statusText, retryAfter);
    }

    return new ApiError(response.status, `http_${response.status}`, response.statusText || `HTTP ${response.status}`, retryAfter);
}

/** The wait in ms a 429 or 503 asks for (`Retry-After`; a bare 429 a minute), else `undefined`. */
export function retryDelayOf(error: ApiError): number | undefined {
    if (error.retryAfter !== undefined && (error.status === 429 || error.status === 503)) {
        return error.retryAfter * 1000;
    }

    return error.status === 429 ? RATE_LIMIT_BACKOFF_MS : undefined;
}

/** `error` when it is an `ApiError`, else a `network_error` (status 0) carrying its message. */
export function asApiError(error: unknown): ApiError {
    if (error instanceof ApiError) {
        return error;
    }

    return new ApiError(0, 'network_error', error instanceof Error ? error.message : String(error));
}
