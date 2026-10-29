/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { tool } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { DataSource } from 'typeorm';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import { Engine, defineAgent } from '@chamvi/core';
import type { EngineOptions } from '@chamvi/core';
import { createDatabaseRepositories } from '@chamvi/store-db';
import { createTestDataSource, describePostgres, truncateRepository } from '../../utils/database.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const WAIT = { timeout: 5_000 };

/** One model turn: a response, optionally held until `before` resolves, or a call that only settles by aborting. */
type Turn = MockResponse | 'hang' | { before: () => Promise<void>; response: MockResponse };

/** A model shared by several engines: turn N of the script answers the Nth call, whichever engine makes it. */
function scripted(script: Turn[]) {
    const calls: LanguageModelV4CallOptions[] = [];
    const model = new MockLanguageModelV4({
        doStream: async (options) => {
            const turn = script[calls.length];
            calls.push(options);
            if (!turn) throw new Error('mock script exhausted');
            if (turn === 'hang') {
                return new Promise((_resolve, reject) => {
                    options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
                });
            }
            if ('before' in turn) {
                await turn.before();
                return mockModel([turn.response]).doStream(options);
            }
            return mockModel([turn]).doStream(options);
        },
    });
    return { model, calls };
}

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

const toolTurn: MockResponse = {
    parts: [{
        type: 'tool-call',
        toolName: 'lookup',
        input: { q: 1 },
    }],
};

const env = {
    agent: 'triage',
    trigger: 'http',
    channel: 'http' as const,
    payload: { issue: 42 },
};

describePostgres('two engines sharing TypeORM repositories', () => {
    let dataSource: DataSource;
    const engines: Engine[] = [];

    function make(
        model: LanguageModel,
        opts: Partial<EngineOptions> & { tools?: () => ToolSet } = {},
    ) {
        const repositories = createDatabaseRepositories({ dataSource });
        const errors: unknown[] = [];
        const agent = defineAgent({
            name: 'triage',
            instructions: 'You triage.',
            model,
            tools: opts.tools,
        });
        const engine = new Engine({
            repositories,
            agents: [agent],
            // Real time: renewal runs every claimTtlMs / 3, so the lease must
            // survive a delayed renewal on a loaded machine.
            claimTtlMs: 3_000,
            onError: (error) => {
                errors.push(error);
            },
            ...opts,
        });
        engines.push(engine);
        return {
            repositories,
            engine, 
            errors, 
        };
    }

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    beforeEach(async () => {
        await truncateRepository(dataSource);
    });

    afterEach(async () => {
        await Promise.all(engines.map((e) => e.drain({ timeoutMs: 1_000 })));
        engines.length = 0;
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('a run drained on one replica is recovered and finished by the other from its checkpoint', async () => {
        const { model, calls } = scripted([toolTurn, 'hang', text('done')]);
        const lookup = vi.fn(async () => 'found');
        const tools = () => ({
            lookup: tool({
                inputSchema: z.object({ q: z.number() }),
                execute: lookup,
            }),
        });
        const a = make(model, { tools, owner: 'A' });
        const b = make(model, { tools, owner: 'B' });

        await a.engine.start();
        const { runId } = await a.engine.dispatch(env);
        await vi.waitFor(() => expect(calls).toHaveLength(2), WAIT);
        await a.engine.drain({ timeoutMs: 50 });
        expect((await a.repositories.runs.findOne(runId))?.status).toBe('interrupted');

        await b.engine.start();
        await b.engine.idle();

        const run = await b.repositories.runs.findOne(runId);
        expect(run).toMatchObject({ status: 'completed', output: 'done' });
        expect(run?.claim).toBeUndefined();
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(calls).toHaveLength(3);
        expect((await b.repositories.checkpoints.findOne(runId))?.stepIndex).toBe(1);
        const steps = await b.repositories.steps.find(runId);
        expect(steps.map((s) => s.kind)).toEqual(['llm', 'tool', 'llm']);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });

    it('the same idempotency key dispatched on both replicas creates one run', async () => {
        const { model } = scripted([text('done')]);
        const a = make(model, { owner: 'A' });
        const b = make(model, { owner: 'B' });
        await a.engine.start();
        await b.engine.start();

        const results = await Promise.all([
            a.engine.dispatch({ ...env, idempotencyKey: 'd1' }),
            b.engine.dispatch({ ...env, idempotencyKey: 'd1' }),
        ]);
        expect(results[0].runId).toBe(results[1].runId);
        expect(results.filter((r) => r.deduplicated)).toHaveLength(1);
        expect((await a.repositories.runs.find({})).total).toBe(1);

        await vi.waitFor(async () => {
            expect((await a.repositories.runs.findOne(results[0].runId))?.status).toBe('completed');
        }, WAIT);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });

    it('a concurrency key admits one run at a time across replicas', async () => {
        const { promise: opened, resolve: open } = Promise.withResolvers<void>();
        const { model } = scripted([{ before: () => opened, response: text('one') }, text('two')]);
        const a = make(model, { owner: 'A' });
        const b = make(model, { owner: 'B' });
        await a.engine.start();
        await b.engine.start();

        const { runId: run1 } = await a.engine.dispatch({ ...env, concurrencyKey: 'k' });
        await vi.waitFor(async () => {
            expect((await a.repositories.runs.findOne(run1))?.status).toBe('running');
        }, WAIT);

        const { runId: run2 } = await b.engine.dispatch({ ...env, concurrencyKey: 'k' });
        await sleep(500);
        expect((await b.repositories.runs.findOne(run2))?.status).toBe('queued');

        open();
        await vi.waitFor(async () => {
            expect((await a.repositories.runs.findOne(run1))?.status).toBe('completed');
            expect((await a.repositories.runs.findOne(run2))?.status).toBe('completed');
        }, WAIT);

        const first = await a.repositories.runs.findOne(run1);
        const second = await a.repositories.runs.findOne(run2);
        expect(second!.startedAt!.getTime()).toBeGreaterThanOrEqual(first!.finishedAt!.getTime());
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });
});
