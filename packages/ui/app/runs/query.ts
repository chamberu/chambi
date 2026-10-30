/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunStatusLiteral } from '@chamvi/core';
import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import type { RunListFilter } from '../api/types.ts';
import { RUN_LIST_PAGE_SIZE, RUN_STATUSES } from './constants.ts';

const first = (value: LocationQuery[string] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) ?? undefined;

/** The runs list filter kept in the route query (`agent`, `status=a,b`, `page`). */
export function filterFromQuery(query: LocationQuery): RunListFilter {
    const agent = first(query.agent) || undefined;
    const status = (first(query.status) ?? '').split(',')
        .filter((value): value is RunStatusLiteral => (RUN_STATUSES as readonly string[]).includes(value));
    const page = Math.max(1, Number.parseInt(first(query.page) ?? '1', 10) || 1);

    return {
        ...(agent ? { agent } : {}),
        ...(status.length > 0 ? { status } : {}),
        limit: RUN_LIST_PAGE_SIZE,
        offset: (page - 1) * RUN_LIST_PAGE_SIZE,
    };
}

export function queryFromFilter(filter: RunListFilter): LocationQueryRaw {
    const page = Math.floor((filter.offset ?? 0) / RUN_LIST_PAGE_SIZE) + 1;

    return {
        ...(filter.agent ? { agent: filter.agent } : {}),
        ...(filter.status?.length ? { status: filter.status.join(',') } : {}),
        ...(page > 1 ? { page: String(page) } : {}),
    };
}
