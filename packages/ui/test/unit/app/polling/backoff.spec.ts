/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { effectScope, ref } from 'vue';
import type { Ref } from 'vue';
import { ApiError } from '../../../../app/api/error.ts';
import type { IApiClient } from '../../../../app/api/types.ts';
import { useApprovals } from '../../../../app/approvals/composables.ts';
import { INBOX_POLL_MS } from '../../../../app/approvals/constants.ts';
import { useRunActivity, useRunCounts, useRunList } from '../../../../app/runs/composables.ts';
import { RUN_COUNTS_POLL_MS, RUN_LIST_POLL_MS } from '../../../../app/runs/constants.ts';
import { useSchedules } from '../../../../app/schedules/composables.ts';
import { SCHEDULES_POLL_MS } from '../../../../app/schedules/constants.ts';
import { fakeClient } from '../../../utils/client.ts';

const RETRY_AFTER_SECONDS = 120;

type Case = {
    name: string;
    method: 'listRuns' | 'listSchedules';
    intervalMs: number;
    use: (client: IApiClient) => { error: Ref<ApiError | undefined> };
};

const cases: Case[] = [
    {
        name: 'useApprovals',
        method: 'listRuns',
        intervalMs: INBOX_POLL_MS,
        use: (client) => useApprovals(client),
    },
    {
        name: 'useRunList',
        method: 'listRuns',
        intervalMs: RUN_LIST_POLL_MS,
        use: (client) => useRunList(client, ref({ limit: 25, offset: 0 })),
    },
    {
        name: 'useRunCounts',
        method: 'listRuns',
        intervalMs: RUN_COUNTS_POLL_MS,
        use: (client) => useRunCounts(client, ['running']),
    },
    {
        name: 'useRunActivity',
        method: 'listRuns',
        intervalMs: RUN_COUNTS_POLL_MS,
        use: (client) => useRunActivity(client),
    },
    {
        name: 'useSchedules',
        method: 'listSchedules',
        intervalMs: SCHEDULES_POLL_MS,
        use: (client) => useSchedules(client),
    },
];

describe('pollers wait out a rate limit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each(cases)('$name waits out a 429 before the next pass', async ({
        method,
        intervalMs,
        use,
    }) => {
        let calls = 0;
        const client = fakeClient({
            [method]: async () => {
                calls++;

                throw new ApiError(429, 'too_many_requests', 'slow down', RETRY_AFTER_SECONDS);
            },
        });
        const scope = effectScope();
        const state = scope.run(() => use(client))!;

        await vi.advanceTimersByTimeAsync(0);
        expect(state.error.value?.status).toBe(429);
        expect(calls).toBe(1);

        await vi.advanceTimersByTimeAsync(intervalMs);
        expect(calls).toBe(1);

        await vi.advanceTimersByTimeAsync(RETRY_AFTER_SECONDS * 1000 - intervalMs);
        expect(calls).toBe(2);
        scope.stop();
    });
});
