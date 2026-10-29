/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineAgent } from '@chamvi/core';
import type { Agent, Engine } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    AppToken,
    ModuleName,
    configModule,
    engineModule,
    repositoryModule,
} from '@chamvi/app';
import type { AppMode, IContainer, IModule } from '@chamvi/app';
import { buildModuleHarness, createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness } from '@chamvi/app/testing';
import { recording, rejectionOf } from '../../utils/app.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { textModel } from '../../utils/model.ts';

function triage(): Agent {
    return defineAgent({
        name: 'triage',
        model: textModel('triaged'),
        instructions: 'triage',
    });
}

let harnesses: ModuleHarness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

function modules(extra: IModule[] = []): IModule[] {
    const clock = new ControllableClock(new Date('2026-10-22T00:00:00Z'));
    return [
        configModule({ clock, logger: createRecordingLogger(clock) }),
        repositoryModule(),
        engineModule(),
        ...extra,
    ];
}

async function start(mode?: AppMode, check?: boolean) {
    const harness = await createModuleHarness({
        mode,
        ...(check && { check }),
        env: {},
        agents: [triage()],
        modules: modules(),
    });
    harnesses.push(harness);
    return harness;
}

async function dispatch(engine: Engine) {
    return engine.dispatch({
        agent: 'triage',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
}

describe('module harness', () => {
    it('setup runs the start steps', async () => {
        const harness = await start();
        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('completed');
    });

    it('job mode does not start the engine', async () => {
        const harness = await start('job');
        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('queued');
    });

    it('a check runs no start steps', async () => {
        const harness = await start('start', true);
        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('queued');
    });

    it('a setup failure tears the ready modules down and rethrows', async () => {
        const events: string[] = [];
        const clock = new ControllableClock(new Date('2026-10-22T00:00:00Z'));
        const failure = new Error('boom');
        const harness = buildModuleHarness({
            env: {},
            modules: [
                recording(configModule({ clock, logger: createRecordingLogger(clock) }), events, 'config'),
                {
                    name: 'failing',
                    dependencies: [ModuleName.CONFIG],
                    async setup(container: IContainer) {
                        expect(container.resolve(AppToken.CONTEXT)).toBeDefined();
                        throw failure;
                    },
                },
            ],
        });
        harnesses.push(harness);

        const error = await rejectionOf(harness.setup());

        expect(error).toBe(failure);
        expect(events).toContain('config teardown');
    });

    it('stop aborts with app_stopped and tears down', async () => {
        const events: string[] = [];
        const clock = new ControllableClock(new Date('2026-10-22T00:00:00Z'));
        const harness = await createModuleHarness({
            env: {},
            modules: [recording(configModule({ clock, logger: createRecordingLogger(clock) }), events, 'config')],
        });

        await harness.stop();

        expect(harness.context.signal.aborted).toBe(true);
        expect((harness.context.signal.reason as { code?: string }).code).toBe('app_stopped');
        expect(events).toContain('config teardown');
    });

    it('report collects into reported', () => {
        const harness = buildModuleHarness();
        const error = new Error('logged');

        harness.context.report(error, { hook: 'x' });

        expect(harness.reported).toEqual([{ error, context: { hook: 'x' } }]);
    });

    it('registers the clock and the context', () => {
        const clock = new ControllableClock(new Date('2026-10-22T00:00:00Z'));
        const harness = buildModuleHarness({
            clock,
            mode: 'job',
            dev: true,
        });

        expect(harness.container.resolve(AppToken.CLOCK)).toBe(clock);
        expect(harness.container.resolve(AppToken.CONTEXT)).toBe(harness.context);
        expect(harness.context).toMatchObject({
            mode: 'job',
            dev: true,
            agents: [],
        });
    });
});
