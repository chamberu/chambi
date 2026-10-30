/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { Engine, defineAgent } from '@chamvi/core';
import type { EngineOptions, IEngine, IStore } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { MemoryAgentRevisionRepository, createMemoryStore } from '../../../src/repository/index.ts';

const answers = (text: string) => Array.from({ length: 5 }, () => ({ parts: [{ type: 'text' as const, text }] }));
const agent = (text: string) => defineAgent({
    name: 'triage',
    model: mockModel(answers(text)),
    instructions: 'x',
});

/** Holds the next marker write or delete at a gate until released. */
class GatedRepository extends MemoryAgentRevisionRepository {
    gate?: Promise<void>;

    entered?: () => void;

    override async save(...args: Parameters<MemoryAgentRevisionRepository['save']>) {
        await this.pass();

        return super.save(...args);
    }

    override async delete(...args: Parameters<MemoryAgentRevisionRepository['delete']>) {
        await this.pass();

        return super.delete(...args);
    }

    arm(): Promise<void> {
        const gate = Promise.withResolvers<void>();

        this.gate = gate.promise;
        this.open = () => {
            this.gate = undefined;
            gate.resolve();
        };

        const entered = Promise.withResolvers<void>();

        this.entered = entered.resolve;

        return entered.promise;
    }

    open: () => void = () => {};

    protected async pass(): Promise<void> {
        if (!this.gate) {
            return;
        }

        this.entered?.();
        await this.gate;
    }
}

function createEngine(store: IStore, clock: ControllableClock, extra: Partial<EngineOptions> = {}): IEngine {
    return new Engine({
        store,
        clock,
        agents: [],
        onError: () => {},
        ...extra,
    });
}

const dispatch = (engine: IEngine) => engine.dispatch({
    agent: 'triage',
    trigger: 'http',
    channel: 'http',
    payload: {},
});

describe('registry races', () => {
    it('a run dispatched while putAgent replaces never executes on the old code', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = { ...createMemoryStore({ clock }), agentRevisions: new GatedRepository() };
        const engine = createEngine(store, clock);

        await engine.putAgent(agent('old code'), { revision: 'h1' });
        await engine.start();

        const entered = store.agentRevisions.arm();
        const replacing = engine.putAgent(agent('new code'), { revision: 'h2' });

        await entered;
        clock.advance(1);

        const { runId } = await dispatch(engine);

        await engine.idle();
        store.agentRevisions.open();
        await replacing;
        clock.advance(60_000);
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.output).not.toBe('old code');
        engine.stop();
    });

    it('a queued run created while the marker moves is kept and runs on the new code', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = { ...createMemoryStore({ clock }), agentRevisions: new GatedRepository() };
        const a = createEngine(store, clock, { owner: 'a' });
        const b = createEngine(store, clock, { owner: 'b' });

        await a.putAgent(agent('old code'), { revision: 'h1' });
        await b.putAgent(agent('old code'), { revision: 'h1' });

        const entered = store.agentRevisions.arm();
        const replacing = a.putAgent(agent('new code'), { revision: 'h2' });

        await entered;
        clock.advance(1);

        const { runId } = await dispatch(b);

        store.agentRevisions.open();
        await replacing;
        expect((await store.runs.findOne(runId))?.status).toBe('queued');

        await b.putAgent(agent('new code'), { revision: 'h2' });
        await b.start();
        await b.idle();
        expect((await store.runs.findOne(runId))?.output).toBe('new code');
        b.stop();
    });

    it('a run dispatched on a lagging replica between two removals is cancelled', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = createMemoryStore({ clock });
        const a = createEngine(store, clock, { owner: 'a' });
        const b = createEngine(store, clock, { owner: 'b' });

        await a.putAgent(agent('v1'), { revision: 'h1' });
        await b.putAgent(agent('v1'), { revision: 'h1' });
        await a.removeAgent('triage');
        clock.advance(10);

        const { runId } = await dispatch(b);

        await b.removeAgent('triage');

        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
    });

    it('a dispatch while removeAgent cancels is refused', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = { ...createMemoryStore({ clock }), agentRevisions: new GatedRepository() };
        const engine = createEngine(store, clock);

        await engine.putAgent(agent('v1'), { revision: 'h1' });

        const entered = store.agentRevisions.arm();
        const removing = engine.removeAgent('triage');

        await entered;
        await expect(dispatch(engine)).rejects.toThrow();
        store.agentRevisions.open();
        await removing;
        expect(engine.getAgent('triage')).toBeUndefined();
    });

    it('a removal at an older revision leaves a newer marker and its runs alone', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = createMemoryStore({ clock });
        const a = createEngine(store, clock, { owner: 'a' });
        const b = createEngine(store, clock, { owner: 'b' });

        await a.putAgent(agent('v1'), { revision: 'h1' });
        await b.putAgent(agent('v1'), { revision: 'h1' });
        await b.putAgent(agent('v2'), { revision: 'h2' });
        clock.advance(10);

        const { runId } = await dispatch(b);

        await a.removeAgent('triage');

        expect((await store.agentRevisions.findOne('triage'))?.hash).toBe('h2');
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
    });
});
