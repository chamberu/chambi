/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ChannelSubscription } from '@chamvi/core';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import {
    cron,
    cronChannel,
    fireCronSubscription,
    readCronOptions,
} from '@chamvi/channel-cron';
import { ControllableClock } from '@chamvi/test-kit';
import { textModel } from '../../utils/model.ts';

const T = new Date('2026-03-01T08:00:00.000Z');
const T_ISO = '2026-03-01T08:00:00.000Z';

function setup(subscription: ChannelSubscription = cron.on('*/5 * * * *')) {
    const clock = new ControllableClock(T);
    const store = createMemoryStore({ clock });
    const agent = defineAgent({
        name: 'sweep',
        model: textModel(),
        instructions: 'x',
        channels: [subscription],
    });
    const engine = new Engine({
        store,
        agents: [agent],
        channels: [cronChannel(), cronChannel({ name: 'cron-eu' })],
        clock,
    });
    const fire = (scheduledAt: Date = T, s: ChannelSubscription = subscription) => fireCronSubscription({
        engine,
        agent,
        subscription: s,
        scheduledAt,
    });

    return {
        clock,
        store,
        agent,
        engine,
        fire,
    };
}

async function runOf(store: ReturnType<typeof createMemoryStore>, result: Awaited<ReturnType<typeof fireCronSubscription>>) {
    if (!result.dispatched) {
        throw new Error('not dispatched');
    }

    const run = await store.runs.findOne(result.runId);

    if (!run) {
        throw new Error('run missing');
    }

    return run;
}

describe('fireCronSubscription', () => {
    it('dispatches with the tick envelope', async () => {
        const { store, fire } = setup();

        const result = await fire();

        expect(result).toMatchObject({ dispatched: true, deduplicated: false });

        const run = await runOf(store, result);

        expect(run.trigger).toMatchObject({
            agent: 'sweep',
            trigger: 'cron:*/5 * * * *',
            channel: 'cron',
            payload: { scheduledAt: T_ISO },
            idempotencyKey: `cron:*/5 * * * *@${T_ISO}`,
            concurrencyKey: 'cron:*/5 * * * *',
        });
        expect(run.concurrencyKey).toBe('cron:*/5 * * * *');
    });

    it('uses the subscription payload when set', async () => {
        const { store, fire } = setup(cron.on('0 * * * *', { payload: { full: true } }));

        const run = await runOf(store, await fire());

        expect(run.trigger.payload).toEqual({ full: true });
        expect(run.trigger.idempotencyKey).toBe(`cron:0 * * * *@${T_ISO}`);
    });

    it('derives the concurrency key from the payload', async () => {
        const { store, fire } = setup({
            ...cron.on('0 * * * *', { payload: { repo: 'a/b' } }),
            concurrencyKey: (p) => (p as { repo: string }).repo,
        });

        const run = await runOf(store, await fire());

        expect(run.concurrencyKey).toBe('a/b');
    });

    it('allow sets no concurrency key', async () => {
        const allow = setup(cron.on('0 * * * *', { overlap: 'allow' }));

        expect((await runOf(allow.store, await allow.fire())).concurrencyKey).toBeUndefined();

        const queueOne = setup(cron.on('0 * * * *', { overlap: 'queue-one' }));

        expect((await runOf(queueOne.store, await queueOne.fire())).concurrencyKey).toBe('cron:0 * * * *');
    });

    it('dispatches through the subscription\'s channel', async () => {
        const eu = cronChannel({ name: 'cron-eu' }).on('0 * * * *');
        const { store, fire } = setup(eu);

        const run = await runOf(store, await fire());

        expect(run.trigger.channel).toBe('cron-eu');
    });

    it('dispatches through a given channel dispatch', async () => {
        const { engine, agent } = setup();
        const dispatched: unknown[] = [];

        await fireCronSubscription({
            engine,
            agent,
            subscription: cron.on('*/5 * * * *'),
            scheduledAt: T,
            dispatch: async (envelope) => {
                dispatched.push(envelope);

                return { runId: 'r1', deduplicated: false };
            },
        });

        expect(dispatched).toEqual([expect.objectContaining({ agent: 'sweep', trigger: 'cron:*/5 * * * *' })]);
        expect(dispatched[0]).not.toHaveProperty('channel');
    });

    it('ignores the subscription\'s own idempotencyKey', async () => {
        const { store, fire } = setup({
            ...cron.on('*/5 * * * *', { overlap: 'allow' }),
            idempotencyKey: () => 'fixed',
        });

        await fire(T);
        await fire(new Date(T.getTime() + 300_000));

        expect((await store.runs.find({ agent: 'sweep' })).total).toBe(2);
    });

    it('a second firing of the same tick is deduplicated', async () => {
        const { store, fire } = setup(cron.on('*/5 * * * *', { overlap: 'allow' }));

        const first = await fire();
        const second = await fire();

        expect(first.dispatched && second).toEqual({
            dispatched: true,
            deduplicated: true,
            runId: first.dispatched ? first.runId : undefined,
        });
        expect((await store.runs.find({ agent: 'sweep' })).total).toBe(1);
    });
});

describe('readCronOptions', () => {
    it('reads a cron subscription', () => {
        const subscription = cron.on('0 9 * * *', { timezone: 'Europe/Berlin', overlap: 'queue-one' });
        const { agent } = setup(subscription);

        expect(readCronOptions(agent, subscription)).toEqual({
            expression: '0 9 * * *',
            timezone: 'Europe/Berlin',
            overlap: 'queue-one',
            payload: undefined,
        });
    });

    it('rejects a malformed cron subscription', () => {
        const { agent } = setup();

        expect(() => readCronOptions(agent, {
            channel: 'cron',
            id: 'x',
            options: {},
        }))
            .toThrow(InvalidAgentDefinitionError);
        expect(() => readCronOptions(agent, {
            channel: 'cron',
            id: 'x',
            options: {},
        }))
            .toThrow(/sweep.*x/);
        expect(() => readCronOptions(agent, {
            channel: 'cron',
            id: 'x',
            options: { expression: '* * * * *', overlap: 'sometimes' },
        })).toThrow(InvalidAgentDefinitionError);
        expect(() => readCronOptions(agent, {
            channel: 'cron',
            id: 'x',
            options: { expression: '* * * * *', timezone: 5 },
        })).toThrow(InvalidAgentDefinitionError);
    });

    it('reads a missing overlap as skip', () => {
        const { agent } = setup();

        expect(readCronOptions(agent, {
            channel: 'cron',
            id: 'x',
            options: { expression: '* * * * *' },
        }).overlap).toBe('skip');
    });
});
