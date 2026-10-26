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
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
    AgentNotFoundError,
    Engine,
    InvalidAgentDefinitionError,
    defineAgent,
} from '@chamvi/core';
import type {
    AgentChange,
    AgentRunsCancelled,
    EngineOptions,
    Run,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { MemoryStore } from '../../../src/store/index.ts';

const model = mockModel([]);
const triage = defineAgent({
    name: 'triage',
    model,
    instructions: 'x',
});
const digest = defineAgent({
    name: 'digest',
    model,
    instructions: 'y',
});

/** Counts the writes of the agent revision store part; fails updates of `failing`. */
class CountingStore extends MemoryStore {
    revisionWrites = 0;

    failing?: string;

    override async updateRun(...args: Parameters<MemoryStore['updateRun']>) {
        if (args[0] === this.failing) throw new Error('store down');
        return super.updateRun(...args);
    }

    override async setAgentRevision(...args: Parameters<MemoryStore['setAgentRevision']>) {
        this.revisionWrites++;
        return super.setAgentRevision(...args);
    }

    override async deleteAgentRevision(...args: Parameters<MemoryStore['deleteAgentRevision']>) {
        this.revisionWrites++;
        return super.deleteAgentRevision(...args);
    }
}

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

function make(opts: Partial<EngineOptions> & { store?: CountingStore; clock?: ControllableClock } = {}) {
    const clock = opts.clock ?? new ControllableClock(new Date(1_000_000));
    const store = opts.store ?? new CountingStore({ clock });
    const changes: AgentChange[] = [];
    const errors: unknown[] = [];
    const engine = new Engine({
        store,
        clock,
        agents: [triage],
        onError: (error) => {
            errors.push(error);
        },
        ...opts,
    });
    engine.on('agents.changed', (e) => {
        changes.push(e);
    });
    engines.push(engine);
    return {
        store,
        clock,
        engine,
        changes,
        errors,
    };
}

const env = (agent = 'triage') => ({
    agent,
    trigger: 'http',
    channel: 'http' as const,
    payload: {},
});

/** Stores a run parked on an approval, as a paused execution leaves it. */
async function parkWaiting(store: MemoryStore, clock: ControllableClock, id: string, agent = 'triage'): Promise<void> {
    const now = clock.now();
    const run: Run = {
        id,
        agent,
        status: 'waiting',
        trigger: {
            ...env(agent),
            id: `t-${id}`,
            receivedAt: now,
        },
        waiting: {
            kind: 'approval',
            approvalId: 'a1',
            toolName: 'tool',
            toolCallId: 'c1',
            title: 'Run tool?',
            expiresAt: new Date(now.getTime() + 60_000),
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt: now,
        updatedAt: now,
    };
    await store.createRun(run);
}

const statusOf = async (engine: Engine, id: string) => (await engine.getRun(id))?.status;

describe('Engine agent registry', () => {
    it('putAgent adds an agent and emits added', async () => {
        const { engine, changes } = make();
        await expect(engine.putAgent(digest)).resolves.toBe('added');
        expect(engine.listAgents().map((a) => a.name)).toEqual(['triage', 'digest']);
        expect(engine.getAgent('digest')).toBe(digest);
        expect(changes).toEqual([{
            type: 'agents.changed', 
            name: 'digest', 
            kind: 'added', 
        }]);
    });

    it('putAgent replaces in place and emits replaced', async () => {
        const { engine, changes } = make({ agents: [triage, digest] });
        const next = defineAgent({
            name: 'triage',
            model,
            instructions: 'z',
        });
        await expect(engine.putAgent(next)).resolves.toBe('replaced');
        expect(engine.listAgents()).toEqual([next, digest]);
        expect(changes).toEqual([{
            type: 'agents.changed', 
            name: 'triage', 
            kind: 'replaced', 
        }]);
    });

    it('a local replace without a revision cancels the runs created before it', async () => {
        const { engine, clock } = make();
        const { runId: before } = await engine.dispatch(env());
        clock.advance(1_000);
        await engine.putAgent(defineAgent({
            name: 'triage',
            model,
            instructions: 'z',
        }));
        expect(await statusOf(engine, before)).toBe('cancelled');
        const { runId: after } = await engine.dispatch(env());
        expect(await statusOf(engine, after)).toBe('queued');
    });

    it('putAgent refuses an unknown channel', async () => {
        const { engine, changes } = make();
        const broken = defineAgent({
            name: 'digest',
            model,
            instructions: 'y',
            channels: [{
                channel: 'nope', 
                id: 'nope', 
                options: {}, 
            }],
        });
        await expect(engine.putAgent(broken)).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(engine.putAgent(broken)).rejects.toThrow('Agent "digest" subscribes to unknown channel "nope".');
        expect(engine.listAgents()).toEqual([triage]);
        expect(changes).toEqual([]);
    });

    it('a first revision writes the marker and cancels nothing', async () => {
        const {
            engine, 
            store, 
            clock, 
        } = make();
        const { runId } = await engine.dispatch(env());
        clock.advance(1_000);
        await engine.putAgent(triage, { revision: 'h1' });
        expect(await statusOf(engine, runId)).toBe('queued');
        expect(await store.getAgentRevision('triage')).toEqual({
            agent: 'triage', 
            hash: 'h1', 
            changedAt: clock.now(), 
        });
        expect(engine.agentRevision('triage')).toBe('h1');
    });

    it('a new revision cancels unsettled runs created before the change, once', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new CountingStore({ clock });
        const a = make({ store, clock });
        const b = make({ store, clock });
        await a.engine.putAgent(triage, { revision: 'h1' });
        await b.engine.putAgent(triage, { revision: 'h1' });

        const { runId: queued } = await a.engine.dispatch(env());
        await parkWaiting(store, clock, 'waiting-run');
        clock.advance(1_000);

        const next = defineAgent({
            name: 'triage',
            model,
            instructions: 'v2',
        });
        await expect(a.engine.putAgent(next, { revision: 'h2' })).resolves.toBe('replaced');
        expect(await statusOf(a.engine, queued)).toBe('cancelled');
        expect(await statusOf(a.engine, 'waiting-run')).toBe('cancelled');
        const changedAt = clock.now();
        expect(await store.getAgentRevision('triage')).toEqual({
            agent: 'triage', 
            hash: 'h2', 
            changedAt, 
        });

        clock.advance(1_000);
        const { runId: fresh } = await a.engine.dispatch(env());
        await b.engine.putAgent(next, { revision: 'h2' });
        expect(await statusOf(b.engine, fresh)).toBe('queued');
        expect(await store.getAgentRevision('triage')).toEqual({
            agent: 'triage', 
            hash: 'h2', 
            changedAt, 
        });
        expect(b.engine.agentRevision('triage')).toBe('h2');
        expect(b.engine.getAgent('triage')).toBe(next);
    });

    it('the same revision again is unchanged', async () => {
        const {
            engine, 
            store, 
            changes, 
        } = make();
        await engine.putAgent(triage, { revision: 'h1' });
        const writes = store.revisionWrites;
        changes.length = 0;
        await expect(engine.putAgent(triage, { revision: 'h1' })).resolves.toBe('unchanged');
        expect(store.revisionWrites).toBe(writes);
        expect(changes).toEqual([]);
    });

    it('waits for the agent lock and gives up after its ttl', async () => {
        const {
            engine, 
            store, 
            clock, 
        } = make();
        await store.acquire('agents:triage', 'someone', 600_000);
        const put = engine.putAgent(triage, { revision: 'h1' });
        let outcome: unknown;
        put.then(() => { outcome = 'resolved'; }, (error: unknown) => { outcome = error; });
        for (let i = 0; i < 20 && outcome === undefined; i++) {
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            clock.advance(20_000);
        }
        expect(outcome).toBeInstanceOf(Error);
        expect((outcome as Error).name).toBe('InvalidRunStateError');
        expect(await store.getAgentRevision('triage')).toBeUndefined();
        expect(engine.agentRevision('triage')).toBeUndefined();
    });

    it('removeAgent cancels unsettled runs and deletes the marker', async () => {
        const {
            engine, 
            store, 
            clock, 
            changes, 
        } = make({ agents: [triage, digest] });
        await engine.putAgent(triage, { revision: 'h1' });
        changes.length = 0;
        const { runId } = await engine.dispatch(env());
        await parkWaiting(store, clock, 'waiting-run');
        const { runId: other } = await engine.dispatch(env('digest'));

        await expect(engine.removeAgent('triage')).resolves.toBe(true);
        expect(await statusOf(engine, runId)).toBe('cancelled');
        expect(await statusOf(engine, 'waiting-run')).toBe('cancelled');
        expect(await statusOf(engine, other)).toBe('queued');
        expect(await store.getAgentRevision('triage')).toBeUndefined();
        expect(engine.listAgents()).toEqual([digest]);
        expect(engine.agentRevision('triage')).toBeUndefined();
        expect(changes).toEqual([{
            type: 'agents.changed', 
            name: 'triage', 
            kind: 'removed', 
        }]);
        await expect(engine.dispatch(env())).rejects.toThrow(AgentNotFoundError);
    });

    it('removeAgent of a code agent cancels its runs', async () => {
        const { engine } = make();
        const { runId } = await engine.dispatch(env());
        await expect(engine.removeAgent('triage')).resolves.toBe(true);
        expect(await statusOf(engine, runId)).toBe('cancelled');
        expect(engine.listAgents()).toEqual([]);
    });

    it('removeAgent of an orphan marker cancels its runs', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new CountingStore({ clock });
        const owner = make({
            store, 
            clock, 
            agents: [digest], 
        });
        await owner.engine.putAgent(triage, { revision: 'h1' });
        await owner.engine.dispatch(env());
        await parkWaiting(store, clock, 'waiting-run');

        const other = make({
            store, 
            clock, 
            agents: [digest], 
        });
        await expect(other.engine.removeAgent('triage')).resolves.toBe(false);
        expect(await statusOf(other.engine, 'waiting-run')).toBe('cancelled');
        const { data } = await store.listRuns({ agent: 'triage' });
        expect(data.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
        expect(await store.getAgentRevision('triage')).toBeUndefined();
        expect(other.changes).toEqual([]);
    });

    it('removeAgent of an unknown name without a marker does nothing', async () => {
        const {
            engine, 
            store, 
            changes, 
        } = make();
        await expect(engine.removeAgent('nope')).resolves.toBe(false);
        expect(store.revisionWrites).toBe(0);
        expect(changes).toEqual([]);
    });

    it('a cancel failure is reported and the other runs are still cancelled', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new CountingStore({ clock });
        store.failing = 'broken';
        const { engine, errors } = make({ store, clock });
        await parkWaiting(store, clock, 'broken');
        await parkWaiting(store, clock, 'fine');
        await engine.removeAgent('triage');
        expect(await statusOf(engine, 'fine')).toBe('cancelled');
        expect(await statusOf(engine, 'broken')).toBe('waiting');
        expect(errors).toEqual([new Error('store down')]);
    });

    it('dispatch of an unknown agent throws AgentNotFoundError', async () => {
        const { engine, store } = make();
        const error = await engine.dispatch(env('nope')).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AgentNotFoundError);
        expect((error as AgentNotFoundError).code).toBe('agent_not_found');
        expect((error as Error).message).toBe('unknown agent: nope');
        expect((await store.listRuns({})).total).toBe(0);
    });
});

/** A model whose calls answer only when released (`release`), or settle by aborting. */
function gatedModel() {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    let calls = 0;
    const model = new MockLanguageModelV4({
        doStream: async (options) => {
            calls++;
            await new Promise<void>((resolve, reject) => {
                options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
                gate.then(() => resolve(), reject);
            });
            return {
                stream: simulateReadableStream({
                    chunks: [
                        { type: 'text-start', id: 't' },
                        {
                            type: 'text-delta', 
                            id: 't', 
                            delta: 'done', 
                        },
                        { type: 'text-end', id: 't' },
                        {
                            type: 'finish',
                            finishReason: { unified: 'stop', raw: undefined },
                            usage: {
                                inputTokens: {
                                    total: 1, 
                                    noCache: 1, 
                                    cacheRead: undefined, 
                                    cacheWrite: undefined, 
                                },
                                outputTokens: {
                                    total: 1, 
                                    text: 1, 
                                    reasoning: undefined, 
                                },
                            },
                        },
                    ],
                }),
            };
        },
    });
    return {
        model,
        release,
        calls: () => calls,
    };
}

const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

describe('cancel reasons', () => {
    const revA = 'a'.repeat(64);
    const revB = 'b'.repeat(64);
    const replacedError = {
        code: 'agent_replaced',
        message: 'Agent "triage" was reloaded at revision bbbbbbbbbbbb; its unsettled runs were cancelled.',
    };
    const next = defineAgent({
        name: 'triage',
        model,
        instructions: 'v2',
    });

    it('a revision change stores agent_replaced on every cancelled run', async () => {
        const {
            engine, 
            store, 
            clock, 
        } = make();
        await engine.putAgent(triage, { revision: revA });
        const { runId } = await engine.dispatch(env());
        await parkWaiting(store, clock, 'waiting-run');
        clock.advance(1_000);
        await engine.putAgent(next, { revision: revB });
        expect(await engine.getRun(runId)).toMatchObject({ status: 'cancelled', error: replacedError });
        expect(await engine.getRun('waiting-run')).toMatchObject({ status: 'cancelled', error: replacedError });
    });

    it('a removal stores agent_removed', async () => {
        const {
            engine, 
            store, 
            clock, 
        } = make();
        await engine.putAgent(triage, { revision: revA });
        await parkWaiting(store, clock, 'waiting-run');
        await engine.removeAgent('triage');
        expect(await engine.getRun('waiting-run')).toMatchObject({
            status: 'cancelled',
            error: {
                code: 'agent_removed',
                message: 'Agent "triage" was removed; its unsettled runs were cancelled.',
            },
        });
    });

    it('replacing a code agent stores agent_replaced without a revision', async () => {
        const { engine, clock } = make();
        const { runId } = await engine.dispatch(env());
        clock.advance(1_000);
        await engine.putAgent(next);
        expect(await engine.getRun(runId)).toMatchObject({
            status: 'cancelled',
            error: {
                code: 'agent_replaced',
                message: 'Agent "triage" was replaced; its unsettled runs were cancelled.',
            },
        });
    });

    it('a running local execution settles cancelled with the reason', async () => {
        const gated = gatedModel();
        const hanging = defineAgent({
            name: 'triage',
            model: gated.model,
            instructions: 'x',
        });
        const { engine, clock } = make({ agents: [hanging] });
        await engine.putAgent(hanging, { revision: revA });
        await engine.start();
        const { runId } = await engine.dispatch(env());
        await vi.waitFor(() => expect(gated.calls()).toBe(1));
        clock.advance(1_000);
        await engine.putAgent(next, { revision: revB });
        await engine.idle();
        expect(await engine.getRun(runId)).toMatchObject({ status: 'cancelled', error: replacedError });
    });

    it('a run running on another replica gets the reason with cancelRequested and keeps it when it settles', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new CountingStore({ clock });
        const gated = gatedModel();
        const hanging = defineAgent({
            name: 'triage',
            model: gated.model,
            instructions: 'x',
        });
        const a = make({
            store, 
            clock, 
            agents: [hanging], 
            owner: 'A', 
            claimTtlMs: 900, 
        });
        const b = make({
            store, 
            clock, 
            agents: [hanging], 
            owner: 'B', 
        });
        await a.engine.putAgent(hanging, { revision: revA });
        await b.engine.putAgent(hanging, { revision: revA });
        await a.engine.start();
        const { runId } = await a.engine.dispatch(env());
        await vi.waitFor(() => expect(gated.calls()).toBe(1));
        clock.advance(1);
        await b.engine.putAgent(next, { revision: revB });
        expect(await store.getRun(runId)).toMatchObject({
            status: 'running', 
            cancelRequested: true, 
            error: replacedError, 
        });
        // A's next poll sees the request and aborts its execution
        await vi.waitFor(async () => {
            clock.advance(300);
            await flush();
            expect((await store.getRun(runId))?.status).toBe('cancelled');
        });
        await a.engine.idle();
        expect(await store.getRun(runId)).toMatchObject({ status: 'cancelled', error: replacedError });
    });

    it('a run that completes despite a cancel request ends without an error', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = new CountingStore({ clock });
        const gated = gatedModel();
        const hanging = defineAgent({
            name: 'triage',
            model: gated.model,
            instructions: 'x',
        });
        const a = make({
            store, 
            clock, 
            agents: [hanging], 
            owner: 'A', 
        });
        const b = make({
            store, 
            clock, 
            agents: [hanging], 
            owner: 'B', 
        });
        await a.engine.putAgent(hanging, { revision: revA });
        await b.engine.putAgent(hanging, { revision: revA });
        await a.engine.start();
        const { runId } = await a.engine.dispatch(env());
        await vi.waitFor(() => expect(gated.calls()).toBe(1));
        clock.advance(1);
        await b.engine.putAgent(next, { revision: revB });
        expect((await store.getRun(runId))?.error).toEqual(replacedError);
        gated.release();
        await a.engine.idle();
        const run = await store.getRun(runId);
        expect(run?.status).toBe('completed');
        expect(run?.error).toBeUndefined();
    });

    it('emits agents.cancelled once per sweep with the run ids', async () => {
        const {
            engine, 
            store, 
            clock, 
        } = make();
        const events: AgentRunsCancelled[] = [];
        engine.on('agents.cancelled', (e) => {
            events.push(e);
        });
        await engine.putAgent(triage, { revision: revA });
        await engine.putAgent(triage, { revision: revA });
        expect(events).toEqual([]);
        await parkWaiting(store, clock, 'w1');
        clock.advance(1_000);
        await engine.putAgent(next, { revision: revB });
        expect(events).toEqual([{
            type: 'agents.cancelled',
            name: 'triage',
            reason: 'agent_replaced',
            revision: revB,
            runIds: ['w1'],
        }]);
        await parkWaiting(store, clock, 'w2');
        await engine.removeAgent('triage');
        expect(events[1]).toEqual({
            type: 'agents.cancelled',
            name: 'triage',
            reason: 'agent_removed',
            runIds: ['w2'],
        });
        expect(events).toHaveLength(2);
    });

    it('a user cancel stores no error', async () => {
        const { engine } = make();
        const { runId } = await engine.dispatch(env());
        await engine.cancel(runId);
        const run = await engine.getRun(runId);
        expect(run?.status).toBe('cancelled');
        expect(run?.error).toBeUndefined();
    });
});
