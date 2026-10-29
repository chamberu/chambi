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
} from 'vitest';
import { Engine, defineAgent } from '@chamvi/core';
import type { EngineOptions, Run } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { createMemoryStores } from '../../../src/store/index.ts';

const answer = () => mockModel([{ parts: [{ type: 'text', text: 'done' }] }]);

/** Runs a hook after the claim, right before the execution looks the agent up. */
class HookedEngine extends Engine {
    beforeExecute: ((engine: HookedEngine, run: Run) => Promise<void> | void) | undefined;

    forget(name: string): void {
        this.agents.delete(name);
        this.revisions.delete(name);
    }

    protected override async execute(run: Run, signal: AbortSignal): Promise<void> {
        await this.beforeExecute?.(this, run);
        return super.execute(run, signal);
    }
}

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

function make(opts: Partial<EngineOptions> & { stores: ReturnType<typeof createMemoryStores>; clock: ControllableClock }) {
    const errors: unknown[] = [];
    const engine = new HookedEngine({
        agents: [],
        onError: (error) => {
            errors.push(error);
        },
        ...opts,
    });
    engines.push(engine);
    return { engine, errors };
}

function setup() {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStores({ clock });
    return { clock, stores: store };
}

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
    const createdAt = new Date(1_000);
    return {
        id,
        agent: 'ghost',
        status: 'queued',
        trigger: {
            id: `t-${id}`,
            agent: 'ghost',
            trigger: 'http',
            channel: 'http',
            payload: {},
            receivedAt: createdAt,
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

const env = (agent = 'triage') => ({
    agent,
    trigger: 'http',
    channel: 'http' as const,
    payload: {},
});

const statusOf = async (store: ReturnType<typeof createMemoryStores>, id: string) => (await store.runs.getRun(id))?.status;

/** One poll of the queue (claimTtlMs 60 s: every 20 s), then everything it started. */
async function poll(engine: Engine, clock: ControllableClock): Promise<void> {
    clock.advance(20_000);
    await engine.idle();
}

describe('execution guard', () => {
    it('a queued run of an unknown agent stays queued', async () => {
        const { clock, stores: store } = setup();
        const model = answer();
        const triage = defineAgent({
            name: 'triage',
            model,
            instructions: 'x',
        });
        const { engine, errors } = make({
            stores: store,
            clock,
            agents: [triage],
        });
        await store.runs.createRun(makeRun('r1'));

        await engine.start();
        await engine.idle();
        await poll(engine, clock);

        expect(await statusOf(store, 'r1')).toBe('queued');
        expect((await store.runs.getRun('r1'))?.claim).toBeUndefined();
        expect(errors).toEqual([]);
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it('a lagging replica does not execute a run after the marker moved', async () => {
        const { clock, stores: store } = setup();
        const modelA = answer();
        const modelB = answer();
        const triageA = defineAgent({
            name: 'triage',
            model: modelA,
            instructions: 'x',
        });
        const triageB = defineAgent({
            name: 'triage',
            model: modelB,
            instructions: 'x',
        });
        const { engine: b, errors: errorsB } = make({
            stores: store,
            clock,
            agents: [],
            owner: 'B',
        });
        const { engine: a, errors: errorsA } = make({
            stores: store,
            clock,
            agents: [],
            owner: 'A',
        });
        await b.putAgent(triageB, { revision: 'h1' });
        await a.putAgent(triageA, { revision: 'h2' });
        expect((await store.agentRevisions.getAgentRevision('triage'))?.hash).toBe('h2');

        await b.start();
        const { runId } = await b.dispatch(env());
        await b.idle();
        await poll(b, clock);
        expect(await statusOf(store, runId)).toBe('queued');
        expect(modelB.doStreamCalls).toHaveLength(0);

        await a.start();
        await a.idle();
        expect(await statusOf(store, runId)).toBe('completed');
        expect(modelA.doStreamCalls).toHaveLength(1);
        expect(modelB.doStreamCalls).toHaveLength(0);
        expect(errorsA).toEqual([]);
        expect(errorsB).toEqual([]);
    });

    it('a code agent is never held back by markers', async () => {
        const { clock, stores: store } = setup();
        const model = answer();
        const triage = defineAgent({
            name: 'triage',
            model,
            instructions: 'x',
        });
        await store.agentRevisions.setAgentRevision({
            agent: 'triage',
            hash: 'h9',
            changedAt: clock.now(),
        });
        const { engine, errors } = make({
            stores: store,
            clock,
            agents: [triage],
        });

        await engine.start();
        const { runId } = await engine.dispatch(env());
        await engine.idle();

        expect(await statusOf(store, runId)).toBe('completed');
        expect(model.doStreamCalls).toHaveLength(1);
        expect(errors).toEqual([]);
    });

    it('a run of an unknown agent with cancelRequested settles cancelled', async () => {
        const { clock, stores: store } = setup();
        const { engine, errors } = make({
            stores: store,
            clock,
            agents: [],
        });
        await store.runs.createRun(makeRun('r1', { cancelRequested: true }));

        await engine.start();
        await engine.idle();

        expect(await statusOf(store, 'r1')).toBe('cancelled');
        expect(errors).toEqual([]);
    });

    it('a run whose agent is removed between claim and execute goes back to queued', async () => {
        const { clock, stores: store } = setup();
        const model = answer();
        const triage = defineAgent({
            name: 'triage',
            model,
            instructions: 'x',
        });
        const { engine, errors } = make({
            stores: store,
            clock,
            agents: [triage],
        });
        engine.beforeExecute = (e) => e.forget('triage');
        const updates: Run['status'][] = [];
        engine.on('run.updated', (e) => {
            updates.push(e.run.status);
        });

        await engine.start();
        const { runId } = await engine.dispatch(env());
        await engine.idle();

        const run = await store.runs.getRun(runId);
        expect(run?.status).toBe('queued');
        expect(run?.claim).toBeUndefined();
        expect(run?.startedAt).toBeUndefined();
        expect(updates).toEqual(['queued', 'running', 'queued']);
        expect(errors).toEqual([]);
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it('a run whose marker moves between claim and execute goes back to queued', async () => {
        const { clock, stores: store } = setup();
        const model = answer();
        const triage = defineAgent({
            name: 'triage',
            model,
            instructions: 'x',
        });
        const { engine, errors } = make({
            stores: store,
            clock,
            agents: [],
        });
        await engine.putAgent(triage, { revision: 'h1' });
        engine.beforeExecute = async () => {
            await store.agentRevisions.setAgentRevision({
                agent: 'triage',
                hash: 'h2',
                changedAt: clock.now(),
            });
        };

        await engine.start();
        const { runId } = await engine.dispatch(env());
        await engine.idle();
        await poll(engine, clock);

        expect(await statusOf(store, runId)).toBe('queued');
        expect(errors).toEqual([]);
        expect(model.doStreamCalls).toHaveLength(0);
    });
});
