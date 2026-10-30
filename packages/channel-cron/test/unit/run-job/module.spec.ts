/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import type {
    AgentDefinition,
    ChannelSubscription,
    IChannel,
} from '@chamvi/core';
import {
    Engine,
    InvalidAgentDefinitionError,
    approve,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import {
    cron,
    cronChannel,
    fireCronSubscription,
    runJob,
} from '@chamvi/channel-cron';
import { ControllableClock } from '@chamvi/test-kit';
import { approvalModel, failingModel, textModel } from '../../utils/model.ts';

const T = new Date('2026-03-01T08:00:00.000Z');

// a channel without behaviour, so a non-cron subscription validates
const http: IChannel = { name: 'http' };
const httpOn: ChannelSubscription = {
    channel: 'http',
    id: 'http',
    options: {},
};

/** A deploy tool that asks for an approval first. */
const gated = (): Partial<AgentDefinition> => ({
    tools: () => ({
        deploy: defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                const decision = await approve(context, { title: 'Deploy?' });

                return decision.approved ? 'deployed' : 'not deployed';
            },
        }),
    }),
});

function setup(
    model: LanguageModel,
    subscriptions: ChannelSubscription[] = [cron.on('*/5 * * * *')],
    extra: Partial<AgentDefinition> = {},
) {
    const clock = new ControllableClock(T);
    const store = createMemoryStore({ clock });
    const channel = cronChannel();
    const agent = defineAgent({
        name: 'sweep',
        model,
        instructions: 'x',
        channels: subscriptions,
        ...extra,
    });
    const channels = [channel, http];
    const engine = new Engine({
        store,
        agents: [agent],
        channels,
        clock,
    });

    return {
        clock,
        store,
        agent,
        channel,
        channels,
        engine,
    };
}

describe('runJob', () => {
    it('returns 0 for a completed run', async () => {
        const {
            store,
            agent,
            engine,
        } = setup(textModel());

        const result = await runJob({
            engine,
            agent,
        });

        expect(result).toMatchObject({ status: 'completed', exitCode: 0 });

        const run = await store.runs.findOne(result.runId as string);

        expect(run?.trigger.idempotencyKey).toMatch(/@2026-03-01T08:00:00\.000Z$/);
    });

    it('takes scheduledAt from the engine clock', async () => {
        const {
            clock,
            store,
            agent,
            engine,
        } = setup(textModel());

        clock.advance(7 * 60_000);

        const result = await runJob({ engine, agent });

        const run = await store.runs.findOne(result.runId as string);

        expect(run?.trigger.payload).toEqual({ scheduledAt: '2026-03-01T08:07:00.000Z' });
    });

    it('returns 1 for a failed run', async () => {
        const {
            agent,
            engine,
        } = setup(failingModel());

        const result = await runJob({
            engine,
            agent,
        });

        expect(result).toMatchObject({ status: 'failed', exitCode: 1 });
    });

    it('returns when the run waits for an approval', async () => {
        const {
            store,
            agent,
            engine,
        } = setup(approvalModel('deploy'), undefined, gated());

        const result = await runJob({
            engine,
            agent,
        });

        expect(result).toMatchObject({ status: 'waiting', exitCode: 0 });
        expect((await store.runs.findOne(result.runId as string))?.status).toBe('waiting');
    });

    it('skips under the overlap policy, still running the engine once', async () => {
        const {
            agent,
            engine,
        } = setup(textModel());
        const subscription = agent.definition.channels?.[0] as ChannelSubscription;

        await fireCronSubscription({
            engine,
            agent,
            subscription,
            scheduledAt: new Date(T.getTime() - 300_000),
        });

        const start = vi.spyOn(engine, 'start');
        const drain = vi.spyOn(engine, 'drain');

        const result = await runJob({
            engine,
            agent,
        });

        expect(result).toEqual({ status: 'skipped', exitCode: 0 });
        expect(result.runId).toBeUndefined();
        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith({ channels: false });
        expect(drain).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    });

    it('recovers a run left running by a killed job pod when it skips', async () => {
        const {
            clock,
            store,
            agent,
            engine,
            channels,
        } = setup(textModel());
        const subscription = agent.definition.channels?.[0] as ChannelSubscription;
        const tick = await fireCronSubscription({
            engine,
            agent,
            subscription,
            scheduledAt: T,
        });
        const { runId } = tick as { runId: string };

        expect(await store.runs.claim(runId, 'pod-1', 60_000)).toBe(true);
        await store.runs.update(runId, { status: 'running' });
        clock.advance(15 * 60_000);

        const pod2 = new Engine({
            store,
            agents: [agent],
            channels,
            clock,
            owner: 'pod-2',
        });
        const result = await runJob({
            engine: pod2,
            agent,
        });

        expect(result).toEqual({ status: 'skipped', exitCode: 0 });
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('times out an expired approval left by an earlier job when it skips', async () => {
        const {
            clock,
            store,
            agent,
            engine,
            channels,
        } = setup(approvalModel('deploy'), undefined, gated());
        const first = await runJob({
            engine,
            agent,
        });

        expect(first.status).toBe('waiting');
        clock.advance(25 * 60 * 60_000);

        const pod2 = new Engine({
            store,
            agents: [agent],
            channels,
            clock,
        });
        const second = await runJob({
            engine: pod2,
            agent,
        });

        expect(second).toEqual({ status: 'skipped', exitCode: 0 });
        expect((await store.runs.findOne(first.runId as string))?.status).toBe('completed');
    });

    it('returns queued when its run waits behind a run paused for an approval', async () => {
        const {
            clock,
            store,
            agent,
            engine,
            channels,
        } = setup(approvalModel('deploy'), [cron.on('*/5 * * * *', { overlap: 'queue-one' })], gated());
        const first = await runJob({
            engine,
            agent,
        });

        expect(first.status).toBe('waiting');
        clock.advance(300_000);

        const pod2 = new Engine({
            store,
            agents: [agent],
            channels,
            clock,
        });
        const drain = vi.spyOn(pod2, 'drain');
        const second = await runJob({
            engine: pod2,
            agent,
        });

        expect(second).toMatchObject({ status: 'queued', exitCode: 0 });
        expect(second.runId).not.toBe(first.runId);
        expect((await store.runs.findOne(second.runId as string))?.status).toBe('queued');
        expect((await store.runs.findOne(first.runId as string))?.status).toBe('waiting');
        expect(drain).toHaveBeenCalledTimes(1);
    });

    it('resolves a run finished by another replica', async () => {
        const {
            clock,
            store,
            agent,
            channels,
        } = setup(textModel());
        const a = new Engine({
            store,
            agents: [agent],
            channels,
            clock,
            owner: 'a',
            concurrencyMaxRuns: 0,
        });
        const b = new Engine({
            store,
            agents: [agent],
            channels,
            clock,
            owner: 'b',
        });

        const job = runJob({
            engine: a,
            agent,
            pollMs: 1_000,
        });

        await vi.waitFor(async () => expect((await store.runs.find({ agent: 'sweep' })).total).toBe(1));
        await b.start();
        await b.idle();
        clock.advance(1_000);

        await expect(job).resolves.toMatchObject({ status: 'completed', exitCode: 0 });
        await b.drain();
    });

    it('stops polling once it returned', async () => {
        const {
            clock,
            store,
            agent,
            engine,
        } = setup(textModel());
        const getRun = vi.spyOn(engine, 'getRun');
        // the run settles while a poll is in flight
        const { promise: gate, resolve: release } = Promise.withResolvers<void>();

        getRun.mockImplementationOnce(async (id) => {
            await gate;

            return store.runs.findOne(id);
        });

        const job = runJob({
            engine,
            agent,
            pollMs: 1_000,
        });

        await vi.waitFor(() => expect(getRun).toHaveBeenCalledTimes(1));
        await engine.idle();
        await expect(job).resolves.toMatchObject({ status: 'completed' });
        release();
        await vi.waitFor(() => expect(getRun.mock.results[0]?.type).toBe('return'));
        await new Promise((resolve) => {
            setImmediate(resolve);
        });

        const calls = getRun.mock.calls.length;

        clock.advance(5_000);
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(getRun.mock.calls.length).toBe(calls);
    });

    it('drains the engine when waiting for the run fails', async () => {
        const {
            agent,
            engine,
        } = setup(textModel());
        const error = new Error('store down');

        vi.spyOn(engine, 'getRun').mockRejectedValue(error);
        vi.spyOn(engine, 'on').mockReturnValue(() => {});

        const drain = vi.spyOn(engine, 'drain');

        await expect(runJob({
            engine,
            agent,
        })).rejects.toBe(error);
        expect(drain).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    });

    it('drains the engine before returning', async () => {
        const {
            agent,
            engine,
        } = setup(textModel());
        const drain = vi.spyOn(engine, 'drain');

        await runJob({
            engine,
            agent,
        });

        expect(drain).toHaveBeenCalledTimes(1);
        expect(drain).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    });

    it('requires a subscription id when the agent has several cron subscriptions', async () => {
        const several = setup(textModel(), [cron.on('*/5 * * * *'), cron.on('0 * * * *')]);

        await expect(runJob({ ...several })).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(runJob({ ...several })).rejects.toThrow(/2 cron subscriptions/);
        await expect(runJob({ ...several, subscription: 'cron:nope' })).rejects.toThrow(InvalidAgentDefinitionError);

        const none = setup(textModel(), [httpOn]);

        await expect(runJob({ ...none })).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(runJob({ ...none, subscription: 'http' })).rejects.toThrow(InvalidAgentDefinitionError);
    });

    it('fires a named subscription', async () => {
        const several = setup(textModel(), [cron.on('*/5 * * * *'), cron.on('0 * * * *')]);

        const result = await runJob({ ...several, subscription: 'cron:0 * * * *' });

        const run = await several.store.runs.findOne(result.runId as string);

        expect(run?.trigger.trigger).toBe('cron:0 * * * *');
        expect(run?.trigger.channel).toBe('cron');
    });

    it('fires a subscription of another cron channel', async () => {
        const clock = new ControllableClock(T);
        const store = createMemoryStore({ clock });
        const eu = cronChannel({ name: 'cron-eu' });
        const agent = defineAgent({
            name: 'sweep',
            model: textModel(),
            instructions: 'x',
            channels: [eu.on('*/5 * * * *')],
        });
        const engine = new Engine({
            store,
            agents: [agent],
            channels: [eu],
            clock,
        });

        const result = await runJob({ engine, agent });

        expect((await store.runs.findOne(result.runId as string))?.trigger.channel).toBe('cron-eu');
    });

    it('never starts channels', async () => {
        const {
            agent,
            channel,
            engine,
        } = setup(textModel());
        const start = vi.spyOn(channel, 'start');

        const result = await runJob({ engine, agent });

        expect(result.status).toBe('completed');
        expect(start).not.toHaveBeenCalled();
    });
});
