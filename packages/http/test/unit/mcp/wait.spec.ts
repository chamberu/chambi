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
import { Engine, MemoryStore } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { buildContext } from '../../../src/app/helpers.ts';
import { waitForRun } from '../../../src/mcp/helpers.ts';
import {
    ADMIN_TOKEN,
    createRunAgents,
    createRunTestApp,
    flush,
    testAuth,
    testChannels,
} from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';
import type { ToolResult } from '../../utils/mcp.ts';

/** Spies on engine.on so every unsubscribe it hands out is a spy. */
function spyOnSubscriptions(engine: Engine) {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const original = engine.on.bind(engine);
    const on: Engine['on'] = (type, listener) => {
        const unsubscribe = vi.fn(original(type, listener));
        unsubscribes.push(unsubscribe);
        return unsubscribe;
    };
    vi.spyOn(engine, 'on').mockImplementation(on);
    return unsubscribes;
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

describe('mcp run_<agent> with waitSeconds', () => {
    it('waits for a completed run and returns its output', async () => {
        const setup = createRunTestApp();
        await setup.engine.start();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const result = await callTool(client, 'run_echo', { waitSeconds: 5 });
        expect(result.structuredContent).toMatchObject({
            status: 'completed',
            deduplicated: false,
        });
        expect(result.structuredContent).toHaveProperty('output');
        await client.close();
        await setup.engine.drain();
    });

    it('returns a waiting run with its pending approval', async () => {
        const setup = createRunTestApp();
        await setup.engine.start();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const result = await callTool(client, 'run_gate', { waitSeconds: 5 });
        expect(result.structuredContent).toMatchObject({
            status: 'waiting',
            waiting: {
                toolName: 'deploy', 
                title: 'Deploy?', 
                body: 'release 1.2', 
            },
        });
        const json = JSON.stringify(result);
        expect(json).not.toContain('resumeToken');
        await client.close();
        await setup.engine.drain();
    });

    it('shows the options of a waiting run', async () => {
        const setup = createRunTestApp();
        await setup.engine.start();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const result = await callTool(client, 'run_choose', { waitSeconds: 5 });
        const { waiting } = (result.structuredContent as { waiting: Record<string, unknown> });
        expect(waiting.options).toEqual([{ id: 'a', label: 'A' }, {
            id: 'b', 
            label: 'B', 
            detail: 'diff', 
        }]);
        expect(Object.keys(waiting)).not.toContain('multiple');
        await client.close();
        await setup.engine.drain();
    });

    it('clamps waitSeconds to maxWaitSeconds', async () => {
        const setup = createRunTestApp();
        const subscriptions = spyOnSubscriptions(setup.engine);
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        let result: ToolResult | undefined;
        const pending = callTool(client, 'run_echo', { waitSeconds: 600 }).then((r) => { result = r; });
        await until(() => subscriptions.length > 0);

        setup.clock.advance(59_999);
        await flush();
        await flush();
        expect(result).toBeUndefined();

        setup.clock.advance(1);
        await pending;
        expect(result?.structuredContent).toMatchObject({ status: 'queued' });
        await client.close();
    });

    it('honours a smaller maxWaitSeconds', async () => {
        const setup = createRunTestApp({ mcp: { maxWaitSeconds: 2 } });
        const subscriptions = spyOnSubscriptions(setup.engine);
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const pending = callTool(client, 'run_echo', { waitSeconds: 30 });
        await until(() => subscriptions.length > 0);
        setup.clock.advance(2_000);
        expect((await pending).structuredContent).toMatchObject({ status: 'queued' });
        await client.close();
    });

    it('sees a run executing on another replica through the store poll', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new MemoryStore({ clock });
        const agents = createRunAgents();
        const setup = createRunTestApp({
            clock,
            store,
            agents,
        });
        const other = new Engine({
            store,
            agents,
            clock,
            channels: testChannels(),
            owner: 'replica-b',
            onError: () => {},
        });
        const subscriptions = spyOnSubscriptions(setup.engine);
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const pending = callTool(client, 'run_echo', { waitSeconds: 10 });
        await until(() => subscriptions.length > 0);

        await other.start();
        await other.idle();
        clock.advance(1_000);
        expect((await pending).structuredContent).toMatchObject({ status: 'completed' });
        await client.close();
        await other.drain();
    });

    it('stops waiting when the http request goes away', async () => {
        const setup = createRunTestApp();
        const subscriptions = spyOnSubscriptions(setup.engine);
        const controller = new AbortController();
        const client = await connectMcp(setup.app, ADMIN_TOKEN, { signal: controller.signal });
        // the client never hears back once its request is gone: do not await the call
        void callTool(client, 'run_echo', { waitSeconds: 30 }).catch(() => undefined);
        await until(() => subscriptions.length > 0);
        const [run] = (await setup.store.listRuns({ agent: 'echo' })).data;

        controller.abort();
        await until(() => subscriptions.every((unsubscribe) => unsubscribe.mock.calls.length > 0));

        const getRun = vi.spyOn(setup.store, 'getRun');
        await flush();
        const calls = getRun.mock.calls.filter(([id]) => id === run!.id).length;
        setup.clock.advance(1_000);
        await flush();
        expect(getRun.mock.calls.filter(([id]) => id === run!.id)).toHaveLength(calls);
        await client.close();
    });
});

describe('waitForRun', () => {
    function context() {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new MemoryStore({ clock });
        const agents = createRunAgents();
        const engine = new Engine({
            store,
            agents,
            clock,
            channels: testChannels(),
            onError: () => {},
        });
        const ctx = buildContext({ engine, auth: testAuth });
        return {
            ctx,
            engine,
            store,
            clock,
        };
    }

    it('resolves at once for an aborted signal and leaves no listener', async () => {
        const {
            ctx,
            engine,
            store,
            clock,
        } = context();
        const { runId } = await engine.dispatch({
            agent: 'echo',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        const subscriptions = spyOnSubscriptions(engine);
        const run = await waitForRun(ctx, runId, {
            timeoutMs: 60_000,
            pollMs: 1_000,
            signal: AbortSignal.abort(),
        });
        expect(run.status).toBe('queued');
        for (const unsubscribe of subscriptions) expect(unsubscribe).toHaveBeenCalledTimes(1);

        const getRun = vi.spyOn(store, 'getRun');
        clock.advance(60_000);
        await flush();
        expect(getRun).not.toHaveBeenCalled();
    });

    it('rejects when the store fails during a poll', async () => {
        const {
            ctx,
            engine,
            store,
            clock,
        } = context();
        const { runId } = await engine.dispatch({
            agent: 'echo',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        const pending = waitForRun(ctx, runId, { timeoutMs: 10_000, pollMs: 1_000 });
        await flush();
        const failure = new Error('store down');
        vi.spyOn(store, 'getRun').mockRejectedValue(failure);
        clock.advance(1_000);
        await expect(pending).rejects.toBe(failure);
    });

    it('answers an mcp store failure with a tool error and reports it', async () => {
        const onError = vi.fn();
        const setup = createRunTestApp({ onError });
        const subscriptions = spyOnSubscriptions(setup.engine);
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const pending = callTool(client, 'run_echo', { waitSeconds: 10 });
        await until(() => subscriptions.length > 0);
        await flush();
        const failure = new Error('store down');
        vi.spyOn(setup.store, 'getRun').mockRejectedValue(failure);
        setup.clock.advance(1_000);
        const result = await pending;
        expect(result.isError).toBe(true);
        expect(onError).toHaveBeenCalledWith(failure);
        await client.close();
    });
});
