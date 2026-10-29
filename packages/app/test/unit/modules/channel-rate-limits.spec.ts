/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineAgent } from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { http } from '@chamvi/http';
import { ControllableClock, textModel } from '@chamvi/test-kit';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    AppToken,
    configModule,
    engineModule,
    httpModule,
    schedulerModule,
    staticTokensModule,
    storeModule,
} from '@chamvi/app';
import type { ChannelRateLimitOptions } from '@chamvi/http';
import { TOKEN, TOKENS } from '../../utils/app.ts';
import { buildHarness } from '../../utils/harness.ts';
import type { Harness } from '../../utils/harness.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { freePort } from '../../utils/port.ts';

const harnesses: Harness[] = [];
afterEach(async () => {
    await Promise.all(harnesses.map((harness) => harness.stop()));
    harnesses.length = 0;
});

describe('httpModule channel policies', () => {
    it.each([false, { max: 2, windowMs: 60_000 }] as const)('forwards %j while retaining REST limits', async (policy: false | ChannelRateLimitOptions) => {
        const port = await freePort();
        const clock = new ControllableClock(new Date('2026-10-28T00:00:00Z'));
        const channel: IChannel = { name: 'github', in: async () => new Response(null, { status: 202 }) };
        const harness = buildHarness({
            env: {
                HOST: '127.0.0.1',
                PORT: String(port),
                CHAMVI_TOKENS: TOKENS,
            },
            agents: [defineAgent({
                name: 'echo',
                instructions: 'Echo.',
                model: textModel(),
                channels: [http.on()],
            })],
            modules: [
                configModule({ clock, logger: createRecordingLogger(clock) }),
                storeModule(),
                staticTokensModule(),
                engineModule(),
                schedulerModule(),
                httpModule({
                    rateLimit: { max: 1 },
                    channelRateLimits: { github: policy },
                    trustProxy: ['127.0.0.1/32'],
                    metrics: false,
                }),
                {
                    name: 'test:github',
                    async setup(container) {
                        container.registerMany(AppToken.CHANNELS, { useValue: channel });
                    },
                },
            ],
        });
        harnesses.push(harness);
        await harness.setup();
        const send = (path: string, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': '192.0.2.1' },
        });
        for (let i = 0; i < 3; i++) {
            const response = await send('/channels/github', 'POST');
            expect(response.status).toBe(policy === false || i < 2 ? 202 : 429);
            await response.text();
        }
        const first = await send('/agents');
        expect(first.status).toBe(200);
        await first.text();
        const second = await send('/agents');
        expect(second.status).toBe(429);
        expect(await second.json()).toMatchObject({ status: 429 });
        expect(harness.reported).toEqual([]);
    });
});
