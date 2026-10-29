/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ChannelSubscription, RunStatusLiteral } from '@chamvi/core';
import {
    Engine,
    createMemoryRepositories,
    defineAgent,
} from '@chamvi/core';
import type { CronTickResult } from '@chamvi/channel-cron';
import { cron, cronChannel, fireCronSubscription } from '@chamvi/channel-cron';
import { ControllableClock } from '@chamvi/test-kit';
import { textModel } from '../../utils/model.ts';

const T = new Date('2026-03-01T08:00:00.000Z');
const at = (tick: number) => new Date(T.getTime() + tick * 300_000);

function setup(subscriptions: ChannelSubscription[]) {
    const clock = new ControllableClock(T);
    const store = createMemoryRepositories({ clock });
    const agent = defineAgent({
        name: 'sweep',
        model: textModel(),
        instructions: 'x',
        channels: subscriptions,
    });
    const engine = new Engine({
        repositories: store,
        agents: [agent],
        channels: [cronChannel()],
        clock,
    });
    const fire = (tick: number, subscription = subscriptions[0] as ChannelSubscription) => fireCronSubscription({
        engine,
        agent,
        subscription,
        scheduledAt: at(tick),
    });
    return {
        clock,
        repositories: store,
        agent,
        engine,
        fire,
    };
}

function idOf(result: CronTickResult): string {
    if (!result.dispatched) throw new Error('not dispatched');
    return result.runId;
}

describe('overlap', () => {
    it.each<RunStatusLiteral>(['queued', 'running', 'waiting', 'interrupted'])(
        'skip: skips while a run of the subscription is %s',
        async (status) => {
            const { repositories: store, fire } = setup([cron.on('*/5 * * * *')]);
            const id = idOf(await fire(0));
            await store.runs.update(id, { status });

            expect(await fire(1)).toEqual({ dispatched: false, reason: 'overlap' });
        },
    );

    it.each<RunStatusLiteral>(['completed', 'failed', 'cancelled'])(
        'skip: dispatches once the run is %s',
        async (status) => {
            const { repositories: store, fire } = setup([cron.on('*/5 * * * *')]);
            const id = idOf(await fire(0));
            await store.runs.update(id, { status });

            expect(await fire(1)).toMatchObject({ dispatched: true, deduplicated: false });
        },
    );

    it('skip: runs of another subscription of the same agent do not block', async () => {
        const first = cron.on('*/5 * * * *');
        const second = cron.on('0 * * * *');
        const { repositories: store, fire } = setup([first, second]);
        const id = idOf(await fire(0, second));
        await store.runs.update(id, { status: 'running' });

        expect(await fire(0, first)).toMatchObject({ dispatched: true });
    });

    it('queue-one: queues one behind an active run', async () => {
        const subscription = cron.on('*/5 * * * *', { overlap: 'queue-one' });
        const { repositories: store, fire } = setup([subscription]);
        const run1 = idOf(await fire(0));
        await store.runs.update(run1, { status: 'running' });

        const run2 = idOf(await fire(1));
        expect((await store.runs.findOne(run2))?.concurrencyKey).toBe(subscription.id);
        expect(await fire(2)).toEqual({ dispatched: false, reason: 'overlap' });

        await store.runs.update(run2, { status: 'running' });
        expect(await fire(3)).toMatchObject({ dispatched: true });
    });

    it('queue-one: the queued run waits for the running one', async () => {
        const {
            clock,
            repositories: store,
            engine,
            fire,
        } = setup([cron.on('*/5 * * * *', { overlap: 'queue-one' })]);
        const run1 = idOf(await fire(0));
        // running on another replica, which holds a live claim (recovery leaves it alone)
        await store.runs.claim(run1, 'elsewhere', 60_000);
        await store.runs.update(run1, { status: 'running' });
        await engine.start();

        const run2 = idOf(await fire(1));
        await engine.idle();
        expect((await store.runs.findOne(run2))?.status).toBe('queued');

        await store.runs.update(run1, { status: 'completed' });
        clock.advance(20_000);
        await engine.idle();
        expect((await store.runs.findOne(run2))?.status).toBe('completed');

        await engine.drain();
    });

    it('allow: always dispatches', async () => {
        const { repositories: store, fire } = setup([cron.on('*/5 * * * *', { overlap: 'allow' })]);

        await fire(0);
        await fire(1);
        await fire(2);

        expect((await store.runs.find({ agent: 'sweep' })).total).toBe(3);
    });
});
