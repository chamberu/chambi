/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { cron } from '@chamvi/channel-cron';
import {
    InvalidAgentDefinitionError,
    MemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { Agent } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import type { IModule } from 'orkos';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    APP_ERROR_CODE,
    AppToken,
    ModuleName,
    configModule,
    createApp,
    storeModule,
} from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import { hangingModel, rejectionOf } from '../../utils/app.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { failingModel, textModel } from '../../utils/model.ts';

const DRAIN_MS = 1_000;
const POLL_MS = 1_000;

let apps: IApp[] = [];

afterEach(async () => {
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    apps = [];
});

function sweep(model: Agent['definition']['model'], channels = [cron.on('*/5 * * * *')]): Agent {
    return defineAgent({
        name: 'sweep',
        model,
        instructions: 'x',
        channels,
    });
}

function build(agents: Agent[], modules: IModule[] = []) {
    const clock = new ControllableClock(new Date('2026-10-21T08:00:00Z'));
    const logger = createRecordingLogger(clock);
    const store = new MemoryStore({ clock });
    const app = createApp({
        agents,
        modules: [configModule({ clock, logger }), storeModule({ store }), ...modules],
    });
    apps.push(app);
    return {
        app,
        clock,
        logger,
        store,
        env: { CHAMVI_DRAIN_TIMEOUT_MS: String(DRAIN_MS) },
    };
}

describe('App.runJob', () => {
    it('runs a cron agent once and returns completed', async () => {
        const {
            app,
            env,
            store,
        } = build([sweep(textModel())]);

        const result = await app.runJob({ env, agent: 'sweep' });

        expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
        expect((await store.getRun(result.runId as string))?.status).toBe('completed');
    });

    it('returns exitCode 1 for a failed run', async () => {
        const { app, env } = build([sweep(failingModel())]);

        expect(await app.runJob({ env, agent: 'sweep' })).toMatchObject({ status: 'failed', exitCode: 1 });
    });

    it('rejects app_stop_failed when the teardown after a completed job reports an error', async () => {
        const after: string[] = [];
        const {
            app,
            env,
            logger,
        } = build([sweep(textModel())], [
            {
                name: 'broken',
                setup: async () => undefined,
                async teardown() {
                    throw new Error('close failed');
                },
            },
            {
                name: 'later',
                setup: async () => undefined,
                async teardown() {
                    after.push('later');
                },
            },
        ]);

        const error = await rejectionOf(app.runJob({ env, agent: 'sweep' }));

        expect(error).toMatchObject({ code: APP_ERROR_CODE.STOP_FAILED });
        expect(after).toEqual(['later']);
        expect(JSON.stringify(logger.entries.filter((e) => e.level === 'error'))).toContain('close failed');
    });

    it('throws InvalidAgentDefinitionError listing the agents for an unknown agent', async () => {
        const other = defineAgent({
            name: 'digest',
            model: textModel(),
            instructions: 'x',
            channels: [cron.on('0 * * * *')],
        });
        const { app, env } = build([sweep(textModel()), other]);

        const error = await rejectionOf(app.runJob({ env, agent: 'nope' }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('No agent "nope"; the app has: sweep, digest.');
    });

    it('throws for an ambiguous subscription, and fires the one named', async () => {
        const { app, env } = build([sweep(textModel(), [cron.on('*/5 * * * *'), cron.on('0 * * * *')])]);

        expect(await rejectionOf(app.runJob({ env, agent: 'sweep' }))).toBeInstanceOf(InvalidAgentDefinitionError);

        const named = build([sweep(textModel(), [cron.on('*/5 * * * *'), cron.on('0 * * * *')])]);
        const result = await named.app.runJob({
            env: named.env, 
            agent: 'sweep', 
            subscription: 'cron:0 * * * *', 
        });
        expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
        expect((await named.store.getRun(result.runId as string))?.trigger).toMatchObject({ channel: 'cron', trigger: 'cron:0 * * * *' });
    });

    it('serves no http during a job', async () => {
        const seen: boolean[] = [];
        const probe: IModule = {
            name: 'probe',
            dependencies: [ModuleName.HTTP],
            setup: async () => undefined,
            async onReady(container) {
                seen.push(container.has(AppToken.SERVER));
            },
        };
        const {
            app,
            env,
            logger,
        } = build([sweep(textModel())], [probe]);

        await app.runJob({ env, agent: 'sweep' });

        expect(seen).toEqual([false]);
        expect(logger.entries.find((e) => e.msg === 'listening')).toBeUndefined();
    });

    it('resolves both the job and stop when stopped during the job', async () => {
        const {
            app,
            env,
            clock,
            store,
        } = build([sweep(hangingModel())]);
        let result: Awaited<ReturnType<IApp['runJob']>> | undefined;
        let stopped = false;
        const job = app.runJob({ env, agent: 'sweep' }).then((r) => {
            result = r;
            return r;
        });

        await vi.waitFor(async () => {
            const { data } = await store.listRuns({ agent: 'sweep' });
            expect(data[0]?.status).toBe('running');
        });
        const stop = app.stop().then(() => {
            stopped = true;
        });
        // the drain timeout lives on the controllable clock
        await vi.waitFor(() => {
            clock.advance(DRAIN_MS);
            expect(result).toBeDefined();
            expect(stopped).toBe(true);
        });
        await stop;

        expect(await job).toMatchObject({ status: 'interrupted', exitCode: 0 });
        const getRun = vi.spyOn(store, 'getRun');
        const listRuns = vi.spyOn(store, 'listRuns');
        clock.advance(10 * POLL_MS);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(getRun).not.toHaveBeenCalled();
        expect(listRuns).not.toHaveBeenCalled();
    });
});
