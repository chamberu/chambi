/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    ChannelNotFoundError,
    Engine,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    ChannelMessage,
    ChannelSendOptions,
    IChannel,
    IEngine,
} from '@chamvi/core';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const START = 1_000_000;
const CLAIM_TTL_MS = 30;

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

type Sent = {
    message: ChannelMessage;
    address: string;
    opts: ChannelSendOptions
};

/** A channel whose `out` answers through `behave` (default: resolves). */
function createChannel(name = 'slack', behave?: (sent: Sent) => Promise<void>) {
    const sent: Sent[] = [];
    const channel: IChannel = {
        name,
        async out(message, address, opts) {
            const entry = {
                message,
                address,
                opts,
            };

            sent.push(entry);

            if (behave) {
                await behave(entry);
            }
        },
    };

    return { channel, sent };
}

const askTool = (channel: string | null, slot?: string) => defineTool({
    inputSchema: z.object({}),
    execute: async (_input, { context }) => {
        const request = { title: 'Close #12?', body: 'stale for 90 days' };
        const decision = channel ?
            await context.channels.findOneOrFail(channel).approve({
                ...request,
                address: 'C0OPS',
                slot,
            }) :
            await approve(context, request);

        return decision.approved;
    },
});

const askModel = (): LanguageModel => mockModel([
    {
        parts: [{
            type: 'tool-call',
            toolName: 'ask',
            input: {},
            toolCallId: 'c1',
        }],
    } satisfies MockResponse,
    { parts: [{ type: 'text', text: 'done' }] },
]);

function createEngine(store: ReturnType<typeof createMemoryStore>, clock: ControllableClock, channels: IChannel[], channel: string | null = 'slack', slot?: string) {
    const errors: unknown[] = [];
    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'release',
            instructions: 'You release.',
            model: askModel(),
            tools: { ask: askTool(channel, slot) },
        })],
        channels,
        clock,
        claimTtlMs: CLAIM_TTL_MS,
        onError: (error) => {
            errors.push(error);
        },
    });

    engines.push(engine);

    return { engine, errors };
}

function setup() {
    const clock = new ControllableClock(new Date(START));
    const store = createMemoryStore({ clock });

    return { clock, store };
}

async function start(engine: IEngine, wait = true) {
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'release',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    if (wait) {
        await engine.idle();
    }

    return runId;
}

describe('approval delivery', () => {
    it('a paused run sends one approval message through the requested channel', async () => {
        const { clock, store } = setup();
        const { channel, sent } = createChannel();
        const { engine, errors } = createEngine(store, clock, [channel]);
        const runId = await start(engine);

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('waiting');

        const waiting = run!.waiting!;

        expect(sent).toHaveLength(1);

        const [{
            message,
            address,
            opts,
        }] = sent as [Sent];

        expect(address).toBe('C0OPS');
        expect(message).toEqual({
            kind: 'approval',
            key: `${runId}:${waiting.approvalId}`,
            runId,
            agent: 'release',
            title: 'Close #12?',
            body: 'stale for 90 days',
            approvalId: '0:c1:0',
            expiresAt: waiting.expiresAt,
        });
        expect(opts.trigger).toEqual(run!.trigger);
        expect(opts.signal).toBeInstanceOf(AbortSignal);

        const json = JSON.stringify(message);

        expect(json).not.toContain('resumeToken');
        expect(waiting.notifiedAt).toBeInstanceOf(Date);

        await engine.tick();
        expect(sent).toHaveLength(1);
        expect(errors).toEqual([]);
    });

    it('a failed send leaves notifiedAt unset and tick() re-sends until one succeeds', async () => {
        const { clock, store } = setup();
        let failures = 2;
        const { channel, sent } = createChannel('slack', async () => {
            if (failures-- > 0) {
                throw new Error('slack is down');
            }
        });
        const { engine, errors } = createEngine(store, clock, [channel]);
        const runId = await start(engine);

        expect(sent).toHaveLength(1);
        expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeUndefined();
        expect(errors).toHaveLength(1);

        await engine.tick();
        expect(sent).toHaveLength(2);
        expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeUndefined();

        await engine.tick();
        expect(sent).toHaveLength(3);
        expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeInstanceOf(Date);

        await engine.tick();
        expect(sent).toHaveLength(3);
        expect(errors).toHaveLength(2);
        expect(new Set(sent.map((s) => s.message.key)).size).toBe(1);
    });

    it('crash after the wait point is stored, before the send: tick() sends exactly once', async () => {
        const { clock, store } = setup();
        // the first replica's send hangs and ignores its signal: it never returns
        const hung = createChannel('slack', () => new Promise(() => {}));
        const first = createEngine(store, clock, [hung.channel]);
        const runId = await start(first.engine, false);

        await vi.waitFor(() => expect(hung.sent).toHaveLength(1));
        // the replica dies: nothing of it runs any more
        first.engine.stop();

        const waiting = (await store.runs.findOne(runId))?.waiting;

        expect(waiting?.notifiedAt).toBeUndefined();

        const { channel, sent } = createChannel();
        const second = createEngine(store, clock, [channel]);

        // the dead replica's send lock is still held
        await second.engine.tick();
        expect(sent).toHaveLength(0);

        clock.advance(CLAIM_TTL_MS + 1);
        await second.engine.tick();
        await second.engine.tick();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.message.key).toBe(`${runId}:${waiting!.approvalId}`);
        expect((await store.runs.findOne(runId))?.waiting).toMatchObject({
            approvalId: waiting!.approvalId,
            notifiedAt: expect.any(Date),
        });
        expect(second.errors).toEqual([]);
    });

    it('retains an approval slot through waiting recovery and retries its original target', async () => {
        const { clock, store } = setup();
        const slot = ' maintainer-status ';
        const failing = createChannel('slack', async () => {
            throw new Error('slack is down');
        });
        const { engine: first } = createEngine(store, clock, [failing.channel], 'slack', slot);
        const runId = await start(first);
        const before = (await store.runs.findOne(runId))!.waiting!;

        expect(before).toMatchObject({
            slot,
            channel: 'slack',
            address: 'C0OPS',
        });
        expect(before.notifiedAt).toBeUndefined();
        expect(failing.sent[0]?.message).toMatchObject({ slot, kind: 'approval' });
        await first.stop();

        const recovered = createChannel();
        const { engine: second } = createEngine(store, clock, [recovered.channel], 'slack', 'different-slot');

        await second.start();
        await second.tick();
        expect(recovered.sent).toHaveLength(1);
        expect(recovered.sent[0]?.message).toEqual(failing.sent[0]?.message);
        expect(recovered.sent[0]?.address).toBe('C0OPS');
        expect((await store.runs.findOne(runId))!.waiting).toMatchObject({ slot, notifiedAt: expect.any(Date) });
        await second.tick();
        expect(recovered.sent).toHaveLength(1);
    });

    it('approve() without a channel sends nothing', async () => {
        const { clock, store } = setup();
        const { channel, sent } = createChannel();
        const { engine, errors } = createEngine(store, clock, [channel], null);
        const runId = await start(engine);
        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('waiting');
        expect(run?.waiting?.channel).toBeUndefined();

        await engine.tick();
        expect(sent).toHaveLength(0);
        expect(errors).toEqual([]);
    });

    it('two replicas ticking concurrently send once', async () => {
        const { clock, store } = setup();
        let fail = true;
        const { promise: gate, resolve: release } = Promise.withResolvers<void>();
        const behave = async () => {
            if (fail) {
                fail = false;

                throw new Error('first send fails');
            }

            await gate;
        };
        const a = createChannel('slack', behave);
        const b = createChannel('slack', behave);
        const first = createEngine(store, clock, [a.channel]);
        const runId = await start(first.engine);

        expect(a.sent).toHaveLength(1);
        expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeUndefined();
        first.engine.stop();

        const second = createEngine(store, clock, [b.channel]);

        const ticks = Promise.all([first.engine.tick(), second.engine.tick()]);

        await vi.waitFor(() => expect(a.sent.length + b.sent.length).toBe(2));
        release();
        await ticks;
        expect(a.sent.length + b.sent.length).toBe(2);
        expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeInstanceOf(Date);

        await Promise.all([first.engine.tick(), second.engine.tick()]);
        expect(a.sent.length + b.sent.length).toBe(2);
    });

    it('an approval naming a channel the engine no longer has goes to onError once per tick', async () => {
        const { clock, store } = setup();
        const down = createChannel('slack', async () => {
            throw new Error('down');
        });
        const failing = createEngine(store, clock, [down.channel]);
        const runId = await start(failing.engine);

        failing.engine.stop();
        expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeUndefined();

        const { engine, errors } = createEngine(store, clock, [], null);

        await engine.tick();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(ChannelNotFoundError);
        await engine.tick();
        expect(errors).toHaveLength(2);
    });
});
