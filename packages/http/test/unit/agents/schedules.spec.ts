/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { defineAgent } from '@chamvi/core';
import { http } from '@chamvi/http';
import { ControllableClock } from '@chamvi/test-kit';
import {
    READER_TOKEN,
    call,
    createTestApp,
    cronOn,
    tokenFor,
} from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

function setup() {
    const clock = new ControllableClock(new Date('2026-10-19T10:30:00Z'));
    const agents = [
        defineAgent({
            name: 'sweep',
            model: textModel(),
            instructions: 'Sweep.',
            channels: [
                cronOn('0 * * * *', { timezone: 'Europe/Berlin' }),
                cronOn('0 9 * * *', { timezone: 'Europe/Berlin', overlap: 'queue-one' }),
            ],
        }),
        defineAgent({
            name: 'echo',
            model: textModel(),
            instructions: 'Echo.',
            channels: [http.on(), cronOn('*/15 * * * *')],
        }),
    ];

    return createTestApp({ agents, clock });
}

describe('GET /schedules', () => {
    it('lists every cron subscription with its next fire time', async () => {
        const { app } = setup();
        const response = await call(app, 'GET', '/schedules', { token: READER_TOKEN });

        expect(response.status).toBe(200);
        expect((await response.json()).data).toEqual([
            {
                agent: 'sweep',
                channel: 'cron',
                trigger: 'cron:0 * * * *',
                expression: '0 * * * *',
                timezone: 'Europe/Berlin',
                overlap: 'skip',
                nextAt: '2026-10-19T11:00:00.000Z',
            },
            {
                agent: 'sweep',
                channel: 'cron',
                trigger: 'cron:0 9 * * *',
                expression: '0 9 * * *',
                timezone: 'Europe/Berlin',
                overlap: 'queue-one',
                // 09:00 CEST
                nextAt: '2026-10-20T07:00:00.000Z',
            },
            {
                agent: 'echo',
                channel: 'cron',
                trigger: 'cron:*/15 * * * *',
                expression: '*/15 * * * *',
                overlap: 'skip',
                nextAt: '2026-10-19T10:45:00.000Z',
            },
        ]);
    });

    it('needs run:read', async () => {
        const { app } = setup();

        expect((await call(app, 'GET', '/schedules', { token: tokenFor() })).status).toBe(403);
        expect((await call(app, 'GET', '/schedules')).status).toBe(401);
    });
});
