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
import type { Agent, ChannelSubscription, IChannel } from '@chamvi/core';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { assertSchedulable, cron, cronChannel } from '@chamvi/channel-cron';
import { createScheduler } from '../../../src/scheduler/module.ts';
import type { IScheduler, SchedulerOptions } from '../../../src/scheduler/types.ts';
import { textModel } from '../../utils/model.ts';

// a channel without behaviour, so subscriptions of another channel validate
const other: IChannel = { name: 'http' };
const otherOn = (id: string): ChannelSubscription => ({
    channel: 'http',
    id,
    options: {},
});
const channels = () => [cronChannel(), cronChannel({ name: 'cron-eu' }), other];

const agentWith = (subscriptions: ChannelSubscription[]) => defineAgent({
    name: 'sweep',
    model: textModel(),
    instructions: 'x',
    channels: subscriptions,
});

describe('createScheduler', () => {
    let schedulers: IScheduler[] = [];

    const make = (
        store: ReturnType<typeof createMemoryStore>,
        agents: Agent[],
        opts: Partial<SchedulerOptions> = {},
    ) => {
        const engine = new Engine({
            store,
            agents,
            channels: channels(),
            owner: opts.owner,
        });
        const scheduler = createScheduler({
            engine,
            channel: 'cron',
            onError: () => {},
            ...opts,
        });

        schedulers.push(scheduler);

        return scheduler;
    };

    const runs = async (store: ReturnType<typeof createMemoryStore>) => (await store.runs.find({ agent: 'sweep' })).data;

    beforeEach(() => {
        vi.useFakeTimers({ now: new Date('2026-03-01T07:59:30Z') });
    });

    afterEach(async () => {
        await Promise.all(schedulers.map((s) => s.stop()));
        schedulers = [];
        vi.useRealTimers();
    });

    it('two replicas on one store dispatch once per tick', async () => {
        const store = createMemoryStore();
        const agents = [agentWith([cron.on('* * * * *', { overlap: 'allow' })])];
        const a = make(store, agents, { owner: 'a' });
        const b = make(store, agents, { owner: 'b' });

        await a.start();
        await b.start();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(await runs(store)).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(await runs(store)).toHaveLength(2);
    });

    it('does not fire on start', async () => {
        const store = createMemoryStore();
        const scheduler = make(store, [agentWith([cron.on('* * * * *')])]);

        await scheduler.start();

        await vi.advanceTimersByTimeAsync(29_000);

        expect(await runs(store)).toHaveLength(0);
    });

    it('a restart between ticks dispatches nothing until the next tick', async () => {
        const store = createMemoryStore();
        const agents = [agentWith([cron.on('* * * * *')])];
        const before = make(store, agents, { owner: 'old' });

        await before.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await before.stop();

        const after = make(store, agents, { owner: 'new' });

        await after.start();
        await vi.advanceTimersByTimeAsync(19_000);
        expect(await runs(store)).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(await runs(store)).toHaveLength(1);
    });

    it('honours the subscription timezone', async () => {
        const store = createMemoryStore();
        const scheduler = make(store, [agentWith([cron.on('0 9 * * *', { timezone: 'Europe/Berlin' })])]);

        await scheduler.start();

        await vi.advanceTimersByTimeAsync(60_000);

        const [run] = await runs(store);

        expect(run?.trigger.payload).toEqual({ scheduledAt: '2026-03-01T08:00:00.000Z' });
    });

    it('ignores subscriptions of other channels', async () => {
        const store = createMemoryStore();
        const scheduler = make(store, [agentWith([otherOn('http'), cronChannel({ name: 'cron-eu' }).on('* * * * *')])]);

        await scheduler.start();

        await vi.advanceTimersByTimeAsync(120_000);

        expect(await runs(store)).toHaveLength(0);
    });

    it('stop() unschedules', async () => {
        const store = createMemoryStore();
        const scheduler = make(store, [agentWith([cron.on('* * * * *', { overlap: 'allow' })])]);

        await scheduler.start();
        await scheduler.stop();

        await vi.advanceTimersByTimeAsync(120_000);

        expect(await runs(store)).toHaveLength(0);
    });

    it('reports a failing lock and keeps ticking', async () => {
        const error = new Error('lock store down');
        const store = createMemoryStore();
        const acquire = store.locks.acquire.bind(store.locks);

        vi.spyOn(store.locks, 'acquire')
            .mockRejectedValueOnce(error)
            .mockImplementation(acquire);

        const onError = vi.fn();
        const scheduler = make(store, [agentWith([cron.on('* * * * *', { overlap: 'allow' })])], { onError });

        await scheduler.start();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(onError).toHaveBeenCalledWith(error, { agent: 'sweep', subscription: 'cron:* * * * *' });
        expect(await runs(store)).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(await runs(store)).toHaveLength(1);
    });

    it('rejects a cron subscription hubwire cannot schedule', () => {
        const store = createMemoryStore();
        const divergent = agentWith([cron.on('0 0 * * 1/2')]);

        expect(() => make(store, [divergent])).toThrow(InvalidAgentDefinitionError);
        expect(() => make(store, [divergent])).toThrow(/sweep.*cron:0 0 \* \* 1\/2/);

        const malformed = agentWith([{
            channel: 'cron',
            id: 'bad',
            options: { expression: 'not a cron', overlap: 'skip' },
        }]);

        expect(() => make(store, [malformed])).toThrow(InvalidAgentDefinitionError);
        expect(() => make(store, [malformed])).toThrow(/sweep.*bad/);
    });

    it('reports a folder agent hubwire cannot schedule instead of throwing', async () => {
        const onError = vi.fn();
        const store = createMemoryStore();
        const engine = new Engine({
            store,
            agents: [],
            channels: channels(),
        });

        await engine.putAgent(agentWith([cron.on('0 0 * * 1/2')]), { revision: 'h1' });

        const scheduler = createScheduler({
            engine,
            channel: 'cron',
            onError,
        });

        schedulers.push(scheduler);

        expect(onError).toHaveBeenCalledWith(expect.any(InvalidAgentDefinitionError), {
            agent: 'sweep',
            subscription: 'cron:0 0 * * 1/2',
        });
    });

    it('assertSchedulable refuses what createScheduler refuses and accepts the rest', () => {
        expect(() => assertSchedulable(agentWith([cron.on('0 0 * * 1/2')]))).toThrow(InvalidAgentDefinitionError);
        expect(() => assertSchedulable(agentWith([cron.on('0 0 * * 1/2')]))).toThrow(/sweep.*cron:0 0 \* \* 1\/2/);
        expect(() => assertSchedulable(agentWith([cron.on('0 9 * * *', { timezone: 'Europe/Berlin' }), otherOn('http')]))).not.toThrow();
        expect(() => assertSchedulable(agentWith([]))).not.toThrow();
    });

    it('assertSchedulable checks only the named channel', () => {
        const eu = cronChannel({ name: 'cron-eu' });
        const agent = agentWith([eu.on('0 0 * * 1/2')]);

        expect(() => assertSchedulable(agent)).not.toThrow();
        expect(() => assertSchedulable(agent, 'cron-eu')).toThrow(InvalidAgentDefinitionError);
    });

    describe('agents changed at runtime', () => {
        const another = () => defineAgent({
            name: 'other',
            model: textModel(),
            instructions: 'x',
            channels: [otherOn('http')],
        });

        const live = (agents: Agent[], opts: Partial<SchedulerOptions> = {}) => {
            const store = createMemoryStore();
            const engine = new Engine({
                store,
                agents,
                channels: channels(),
            });
            const scheduler = createScheduler({
                engine,
                channel: 'cron',
                onError: () => {},
                ...opts,
            });

            schedulers.push(scheduler);

            return {
                store,
                engine,
                scheduler,
            };
        };

        it('schedules an agent added after start', async () => {
            const {
                store,
                engine,
                scheduler,
            } = live([another()]);

            await scheduler.start();

            await engine.putAgent(agentWith([cron.on('* * * * *', { overlap: 'allow' })]));
            await vi.advanceTimersByTimeAsync(60_000);

            expect(await runs(store)).toHaveLength(1);
        });

        it('starts an agent added before start only once started', async () => {
            const {
                store,
                engine,
                scheduler,
            } = live([another()]);

            await engine.putAgent(agentWith([cron.on('* * * * *', { overlap: 'allow' })]));

            await vi.advanceTimersByTimeAsync(60_000);
            expect(await runs(store)).toHaveLength(0);

            await scheduler.start();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(await runs(store)).toHaveLength(1);
        });

        it('a replaced agent fires on its new expression only', async () => {
            const {
                store,
                engine,
                scheduler,
            } = live([agentWith([cron.on('* * * * *', { overlap: 'allow' })])]);

            await scheduler.start();

            await engine.putAgent(agentWith([cron.on('0 9 * * *', { timezone: 'UTC' })]));
            await vi.advanceTimersByTimeAsync(120_000);
            expect(await runs(store)).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(3_600_000);

            const fired = await runs(store);

            expect(fired.map((run) => run.trigger.trigger)).toEqual(['cron:0 9 * * *']);
        });

        it('a removed agent no longer fires', async () => {
            const onError = vi.fn();
            const {
                store,
                engine,
                scheduler,
            } = live([agentWith([cron.on('* * * * *', { overlap: 'allow' })]), another()], { onError });

            await scheduler.start();

            await engine.removeAgent('sweep');
            await vi.advanceTimersByTimeAsync(120_000);

            expect(await runs(store)).toHaveLength(0);
            expect(onError).not.toHaveBeenCalled();
        });

        it('reports a replaced agent hubwire cannot schedule', async () => {
            const onError = vi.fn();
            const {
                store,
                engine,
                scheduler,
            } = live([agentWith([cron.on('* * * * *', { overlap: 'allow' })])], { onError });

            await scheduler.start();

            await engine.putAgent(agentWith([cron.on('0 0 * * 1/2')]));

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError).toHaveBeenCalledWith(expect.any(InvalidAgentDefinitionError), {
                agent: 'sweep',
                subscription: 'cron:0 0 * * 1/2',
            });
            await vi.advanceTimersByTimeAsync(120_000);
            expect(await runs(store)).toHaveLength(0);
        });

        it('stop() ends the subscription', async () => {
            const {
                store,
                engine,
                scheduler,
            } = live([another()]);

            await scheduler.start();
            await scheduler.stop();

            await engine.putAgent(agentWith([cron.on('* * * * *', { overlap: 'allow' })]));
            await scheduler.start();
            await vi.advanceTimersByTimeAsync(120_000);

            expect(await runs(store)).toHaveLength(0);
        });
    });

    it('rejects an invalid lockTtlMs', () => {
        const store = createMemoryStore();
        const agents = [agentWith([cron.on('* * * * *')])];

        expect(() => make(store, agents, { lockTtlMs: 0 })).toThrow(InvalidAgentDefinitionError);
    });
});
