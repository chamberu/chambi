/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import type { ScheduleWire } from '../../../../app/api/types.ts';
import { groupByAgent } from '../../../../app/schedules/helpers.ts';
import { withoutIteratorHelpers } from '../../../utils/iterator.ts';
import { useSchedules } from '../../../../app/schedules/composables.ts';
import { apiError, fakeClient } from '../../../utils/client.ts';
import { flush } from '../../../utils/timers.ts';

const schedule = (agent: string, trigger: string, nextAt: string): ScheduleWire => ({
    agent,
    channel: 'cron',
    trigger,
    expression: '0 8 * * 1-5',
    overlap: 'skip',
    nextAt,
});

describe('useSchedules', () => {
    it('lists schedules', async () => {
        const list = [schedule('digest', 'cron:a', '2026-10-22T06:00:00.000Z')];
        const client = fakeClient({ listSchedules: async () => list });
        const scope = effectScope();
        const schedules = scope.run(() => useSchedules(client))!;

        await flush();
        expect(schedules.schedules.value).toEqual(list);
        scope.stop();
    });

    it('a 403 sets error without throwing', async () => {
        const client = fakeClient({
            listSchedules: async () => {
                throw apiError(403, 'forbidden');
            },
        });
        const scope = effectScope();
        const schedules = scope.run(() => useSchedules(client))!;

        await flush();
        expect(schedules.error.value?.status).toBe(403);
        scope.stop();
    });
});

describe('groupByAgent', () => {
    it('groups by agent name, each sorted by the next fire time', () => {
        const groups = groupByAgent([
            schedule('triage', 'cron:x', '2026-10-22T09:00:00.000Z'),
            schedule('digest', 'cron:b', '2026-10-23T06:00:00.000Z'),
            schedule('digest', 'cron:a', '2026-10-22T06:00:00.000Z'),
        ]);

        expect(groups.map((g) => [g.agent, g.schedules.map((s) => s.trigger)])).toEqual([
            ['digest', ['cron:a', 'cron:b']],
            ['triage', ['cron:x']],
        ]);
    });

    it('needs no iterator helpers (Safari before 18.4)', () => {
        const groups = withoutIteratorHelpers(() => groupByAgent([schedule('triage', 'cron:x', '2026-10-22T09:00:00.000Z')]));

        expect(groups.map((g) => g.agent)).toEqual(['triage']);
    });
});
