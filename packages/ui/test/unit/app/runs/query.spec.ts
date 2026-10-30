/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { filterFromQuery, queryFromFilter } from '../../../../app/runs/query.ts';

describe('run list query', () => {
    it('reads agent, known statuses and the page', () => {
        expect(filterFromQuery({
            agent: 'deploy',
            status: 'waiting,nope,failed',
            page: '3',
        })).toEqual({
            agent: 'deploy',
            status: ['waiting', 'failed'],
            limit: 25,
            offset: 50,
        });
        expect(filterFromQuery({ page: 'x' })).toEqual({ limit: 25, offset: 0 });
    });

    it('round-trips through the query', () => {
        const filter = {
            agent: 'a',
            status: ['queued' as const],
            limit: 25,
            offset: 25,
        };

        expect(queryFromFilter(filter)).toEqual({
            agent: 'a',
            status: 'queued',
            page: '2',
        });
        expect(filterFromQuery(queryFromFilter(filter) as Record<string, string>)).toEqual(filter);
        expect(queryFromFilter({ limit: 25, offset: 0 })).toEqual({});
    });
});
