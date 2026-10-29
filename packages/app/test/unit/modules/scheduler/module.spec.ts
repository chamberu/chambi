/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { cron } from '@chamvi/channel-cron';
import { defineAgent } from '@chamvi/core';
import type { Agent } from '@chamvi/core';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    AppToken,
    ModuleName,
    configModule,
    engineModule,
    schedulerModule,
    storeModule,
} from '@chamvi/app';
import type { AppMode } from '@chamvi/app';
import { createHarness } from '../../../utils/harness.ts';
import type { Harness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';
import { mockModel } from '@chamvi/test-kit';


function sweep(): Agent {
    return defineAgent({
        name: 'sweep',
        model: mockModel(Array.from({ length: 10 }, () => ({ parts: [{ type: 'text' as const, text: 'swept' }] }))),
        instructions: 'sweep',
        channels: [cron.on('* * * * *', { overlap: 'allow' })],
    });
}

let harnesses: Harness[] = [];

beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-03-01T07:59:30Z') });
});

/** Advances the faked timers until the promise settled (a drain waits on the engine's timers). */
async function settle(promise: Promise<void>): Promise<void> {
    let done = false;
    const tracked = promise.finally(() => {
        done = true;
    });
    while (!done) {
        await vi.advanceTimersByTimeAsync(1_000);
    }
    await tracked;
}

afterEach(async () => {
    await settle(Promise.all(harnesses.map((h) => h.stop())).then(() => undefined));
    harnesses = [];
    vi.useRealTimers();
});

async function setup(options: { mode?: AppMode; env?: Record<string, string> } = {}) {
    // systemClock follows the faked Date (hubwire takes no IClock)
    const logger = createRecordingLogger();
    const harness = await createHarness({
        mode: options.mode,
        env: { ...options.env },
        agents: [sweep()],
        modules: [
            configModule({ logger }),
            storeModule(),
            engineModule(),
            schedulerModule(),
        ],
    });
    harnesses.push(harness);
    return harness;
}

async function runs(harness: Harness) {
    return (await harness.container.resolve(AppToken.STORE).listRuns({ agent: 'sweep' })).data;
}

describe('schedulerModule', () => {
    it('is named and depends on the config module', () => {
        const module = schedulerModule();
        expect(module.name).toBe(ModuleName.SCHEDULER);
        expect(module.dependencies).toEqual([ModuleName.CONFIG]);
    });

    it('contributes the cron channel, which engine.start() starts in start mode', async () => {
        const harness = await setup();
        const engine = harness.container.resolve(AppToken.ENGINE);
        expect(engine.getChannel('cron')?.start).toBeTypeOf('function');

        await vi.advanceTimersByTimeAsync(30_000);
        expect(await runs(harness)).toHaveLength(1);
    });

    it('CHAMVI_SCHEDULER=false contributes a cron channel that fires nothing', async () => {
        const harness = await setup({ env: { CHAMVI_SCHEDULER: 'false' } });
        const channel = harness.container.resolve(AppToken.ENGINE).getChannel('cron');
        expect(channel?.name).toBe('cron');
        expect(channel?.start).toBeUndefined();

        await vi.advanceTimersByTimeAsync(120_000);
        expect(await runs(harness)).toHaveLength(0);
    });

    it('job mode registers the cron channel but never starts it', async () => {
        const harness = await setup({ mode: 'job' });
        expect(harness.container.resolve(AppToken.ENGINE).getChannel('cron')?.start).toBeTypeOf('function');

        await vi.advanceTimersByTimeAsync(120_000);
        expect(await runs(harness)).toHaveLength(0);
    });

    it('teardown stops it', async () => {
        const harness = await setup();
        const store = harness.container.resolve(AppToken.STORE);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await runs(harness)).toHaveLength(1);

        await settle(harness.stop());
        await vi.advanceTimersByTimeAsync(180_000);
        expect((await store.listRuns({ agent: 'sweep' })).data).toHaveLength(1);
    });
});
