/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { Engine, InvalidAgentDefinitionError, createMemoryStore } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { createShutdown } from '@chamvi/http';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunAgents,
    createRunTestApp,
    createTestApp,
    flush,
    testChannels,
} from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';
import { SseReader } from '../../utils/sse.ts';

type App = ReturnType<typeof createRunTestApp>['app'];

async function start(app: App, agent = 'echo'): Promise<string> {
    const response = await call(app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN });
    return (await response.json() as { runId: string }).runId;
}

/** Opens a stream of `runId` and reads its snapshot. */
async function open(app: App, runId: string, signal?: AbortSignal): Promise<SseReader> {
    const response = await call(app, 'GET', `/runs/${runId}/stream`, { token: READER_TOKEN, signal });
    expect(response.status).toBe(200);
    const reader = new SseReader(response);
    await reader.next(1);
    return reader;
}

async function streamStatus(app: App, runId: string): Promise<Response> {
    return call(app, 'GET', `/runs/${runId}/stream`, { token: READER_TOKEN });
}

/**
 * With `maxOpen: 1`: a free slot opens one stream and refuses the next,
 * so the counter is exactly 0 (not negative) after an exit path.
 */
async function expectExactlyOneFreeSlot(app: App, runId: string): Promise<void> {
    const controller = new AbortController();
    await open(app, runId, controller.signal);
    const refused = await streamStatus(app, runId);
    expect(refused.status).toBe(503);
    await refused.body?.cancel();
    controller.abort();
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (await check()) return;
        await flush();
    }
    throw new Error('condition never held');
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('stream.maxOpen', () => {
    it.each([0, -1, 1.5, NaN, Infinity])('refuses %s at createHttpApp', (maxOpen) => {
        expect(() => createTestApp({ stream: { maxOpen } })).toThrow(InvalidAgentDefinitionError);
    });

    it('accepts a positive integer', () => {
        expect(() => createTestApp({ stream: { maxOpen: 1 } })).not.toThrow();
    });

    it('answers 503 with Retry-After once the cap is reached, without reporting it', async () => {
        const onError = vi.fn();
        const { app } = createRunTestApp({ stream: { maxOpen: 2 }, onError });
        const runId = await start(app);
        const first = await open(app, runId);
        const second = await open(app, runId);

        const refused = await streamStatus(app, runId);
        expect(refused.status).toBe(503);
        expect(refused.headers.get('retry-after')).toBe('5');
        expect(refused.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(await refused.json()).toEqual({
            status: 503,
            code: 'service_unavailable',
            message: 'Too many open streams, retry later.',
        });
        expect(onError).not.toHaveBeenCalled();
        await first.reader.cancel();
        await second.reader.cancel();
    });

    it('frees the slot when the request signal aborts', async () => {
        const { app } = createRunTestApp({ stream: { maxOpen: 1 } });
        const runId = await start(app);
        const controller = new AbortController();
        await open(app, runId, controller.signal);
        expect((await streamStatus(app, runId)).status).toBe(503);

        controller.abort();
        await expectExactlyOneFreeSlot(app, runId);
    });

    it('frees the slot when the client cancels the body (at the next write)', async () => {
        const { app, clock } = createRunTestApp({ stream: { maxOpen: 1 } });
        const runId = await start(app);
        const reader = await open(app, runId);
        await reader.reader.cancel();
        clock.advance(2_000);
        await flush();

        await expectExactlyOneFreeSlot(app, runId);
    });

    it('frees the slot when a stream ends with its settled run', async () => {
        const { app, engine } = createRunTestApp({ stream: { maxOpen: 1 } });
        const runId = await start(app);
        const reader = await open(app, runId);
        await engine.start();
        await engine.idle();
        await reader.rest();
        expect(reader.done).toBe(true);

        await engine.drain();
        // a settled run's stream ends at once: probe with a queued one
        await expectExactlyOneFreeSlot(app, await start(app));
    });

    it('frees the slot of a settled run streamed at once', async () => {
        const { app, store } = createRunTestApp({ stream: { maxOpen: 1 } });
        const runId = await start(app);
        await store.runs.update(runId, { status: 'failed' });
        const reader = await open(app, runId);
        await reader.rest();

        const other = await start(app);
        await expectExactlyOneFreeSlot(app, other);
    });

    it('frees the slot when the snapshot fails', async () => {
        const ctx = createRunTestApp({ stream: { maxOpen: 1 }, onError: () => {} });
        const runId = await start(ctx.app);
        vi.spyOn(ctx.store.steps, 'find').mockRejectedValueOnce(new Error('store down'));
        expect((await streamStatus(ctx.app, runId)).status).toBe(500);

        await expectExactlyOneFreeSlot(ctx.app, runId);
    });

    it('frees the slot when the poll fails', async () => {
        const ctx = createRunTestApp({ stream: { maxOpen: 1 }, onError: () => {} });
        const runId = await start(ctx.app);
        const reader = await open(ctx.app, runId);
        vi.spyOn(ctx.store.runs, 'findOne').mockRejectedValueOnce(new Error('store down'));
        ctx.clock.advance(2_000);
        await reader.rest();

        await expectExactlyOneFreeSlot(ctx.app, runId);
    });

    it('frees the slots on shutdown', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = createMemoryStore({ clock });
        const agents = createRunAgents();
        const engine = new Engine({
            store,
            agents,
            clock,
            channels: testChannels(),
            onError: () => {},
        });
        const shutdown = createShutdown({ engine });
        const { app } = createRunTestApp({
            engine,
            shutdown,
            stream: { maxOpen: 1 },
        });
        const runId = await start(app);
        const reader = await open(app, runId);
        const client = await connectMcp(app, ADMIN_TOKEN);
        // over the cap: answers at once
        const result = await callTool(client, 'run_echo', { waitSeconds: 30 });
        expect(result.structuredContent).toMatchObject({ status: 'queued' });

        await shutdown.shutdown();
        expect(await reader.rest()).toEqual([]);
        await client.close().catch(() => undefined);
    });

    describe('mcp run_<agent> waits', () => {
        it('answer at once with the dispatched run when the cap is reached', async () => {
            const { app, store } = createRunTestApp({ stream: { maxOpen: 1 } });
            const runId = await start(app);
            const reader = await open(app, runId);
            const client = await connectMcp(app, ADMIN_TOKEN);

            const result = await callTool(client, 'run_echo', { waitSeconds: 30 });
            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toEqual({
                runId: expect.any(String),
                status: 'queued',
                deduplicated: false,
            });
            const dispatched = await store.runs.findOne(result.structuredContent!.runId as string);
            expect(dispatched?.status).toBe('queued');

            await reader.reader.cancel();
            await client.close();
        });

        it('hold a slot while they wait and free it once answered', async () => {
            const setup = createRunTestApp({ stream: { maxOpen: 1 } });
            const client = await connectMcp(setup.app, ADMIN_TOKEN);
            const subscribe = vi.spyOn(setup.engine, 'on');
            const pending = callTool(client, 'run_echo', { waitSeconds: 10 });
            await until(() => subscribe.mock.calls.length > 0);
            const [run] = (await setup.store.runs.find({ agent: 'echo' })).data;

            expect((await streamStatus(setup.app, run!.id)).status).toBe(503);

            setup.clock.advance(10_000);
            expect((await pending).structuredContent).toMatchObject({ status: 'queued' });
            await expectExactlyOneFreeSlot(setup.app, run!.id);
            await client.close();
        });

        it('free the slot when the run completes', async () => {
            const setup = createRunTestApp({ stream: { maxOpen: 1 } });
            await setup.engine.start();
            const client = await connectMcp(setup.app, ADMIN_TOKEN);
            const result = await callTool(client, 'run_echo', { waitSeconds: 5 });
            expect(result.structuredContent).toMatchObject({ status: 'completed' });

            await client.close();
            await setup.engine.drain();
            // a settled run's stream ends at once: probe with a queued one
            await expectExactlyOneFreeSlot(setup.app, await start(setup.app));
        });

        it('free the slot when the http request goes away', async () => {
            const setup = createRunTestApp({ stream: { maxOpen: 1 } });
            const controller = new AbortController();
            const client = await connectMcp(setup.app, ADMIN_TOKEN, { signal: controller.signal });
            const subscribe = vi.spyOn(setup.engine, 'on');
            void callTool(client, 'run_echo', { waitSeconds: 30 }).catch(() => undefined);
            await until(() => subscribe.mock.calls.length > 0);
            const [run] = (await setup.store.runs.find({ agent: 'echo' })).data;

            controller.abort();
            await until(async () => {
                // a stream that opens frees its slot again at once
                const probe = new AbortController();
                const response = await call(setup.app, 'GET', `/runs/${run!.id}/stream`, { token: READER_TOKEN, signal: probe.signal });
                probe.abort();
                return response.status === 200;
            });
            await expectExactlyOneFreeSlot(setup.app, run!.id);
            await client.close();
        });

        it('free the slot when the wait fails', async () => {
            const setup = createRunTestApp({ stream: { maxOpen: 1 }, onError: () => {} });
            const client = await connectMcp(setup.app, ADMIN_TOKEN);
            const getRun = setup.store.runs.findOne.bind(setup.store.runs);
            let failed = false;
            vi.spyOn(setup.store.runs, 'findOne').mockImplementation(async (id) => {
                if (!failed) {
                    failed = true;
                    throw new Error('store down');
                }
                return getRun(id);
            });
            const result = await callTool(client, 'run_echo', { waitSeconds: 5 });
            expect(result.isError).toBe(true);
            const [run] = (await setup.store.runs.find({ agent: 'echo' })).data;

            await expectExactlyOneFreeSlot(setup.app, run!.id);
            await client.close();
        });
    });
});
