/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { github, githubChannel } from '@chamvi/github';
import { createHttpApp } from '@chamvi/http';
import { MockLanguageModelV4 } from 'ai/test';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import { createGithubFixture, deliver } from '../../utils/app.ts';
import { mockModel, textModel } from '../../utils/model.ts';

const BODY = readFileSync(new URL('../../fixtures/deliveries/issues-opened.json', import.meta.url), 'utf8');
let engine: Engine | undefined;

afterEach(async () => {
    await engine?.drain({ timeoutMs: 0 });
    engine = undefined;
});

describe('GitHub burst admission', () => {
    it('persists signed bursts before replying while nested caps leave room for another agent', async () => {
        const { gh, clock } = createGithubFixture();
        const channel = githubChannel({ app: gh, clock });
        const store = createMemoryStore({ clock });
        const errors: unknown[] = [];
        const entered: string[] = [];
        const releases = new Map<string, () => void>();
        let active = 0;
        let peak = 0;
        const agent = defineAgent({
            name: 'triage',
            instructions: 'Inspect the issue.',
            concurrencyMaxRuns: 2,
            channels: [github.on('issues.opened', { concurrencyMaxRuns: 1 })],
            model: new MockLanguageModelV4({
                doStream: (options) => mockModel([{
                    parts: options.prompt.some((message) => message.role === 'tool') ?
                        [{ type: 'text', text: 'done' }] :
                        [{
                            type: 'tool-call',
                            toolName: 'hold',
                            input: {},
                        }],
                }]).doStream(options),
            }),
            tools: (ctx) => ({
                hold: defineTool({
                    description: 'Inspect until released.',
                    inputSchema: z.object({}),
                    execute: async () => {
                        entered.push(ctx.run.runId);
                        active++;
                        peak = Math.max(peak, active);
                        try {
                            await new Promise<void>((resolve) => {
                                releases.set(ctx.run.runId, resolve);
                                ctx.run.signal.addEventListener('abort', () => resolve(), { once: true });
                            });
                        } finally {
                            active--;
                        }
                        return 'inspected';
                    },
                }),
            }),
        });
        const other = defineAgent({
            name: 'other',
            instructions: 'Respond.',
            model: textModel(),
            channels: [],
        });
        engine = new Engine({
            store,
            clock,
            agents: [agent, other],
            channels: [channel],
            onError: (error) => { errors.push(error); },
        });
        const app = createHttpApp({
            engine,
            auth: [async () => undefined],
            channels: [channel],
            rateLimit: { max: 1 },
            channelRateLimits: { github: false },
            metrics: false,
        });
        await engine.start();
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
            const body = JSON.parse(BODY);
            body.issue.number = i + 1;
            const response = await deliver(app, {
                event: 'issues',
                delivery: `burst-${i}`,
                body: JSON.stringify(body),
            });
            expect(response.status).toBe(202);
            const result = await response.json() as { runs: Array<{ runId: string }> };
            const id = result.runs[0]!.runId;
            ids.push(id);
            expect(await store.runs.findOne(id)).toMatchObject({ id, agent: 'triage' });
        }
        await vi.waitFor(() => expect(entered).toHaveLength(1));
        expect((await store.runs.find({ agent: 'triage', status: ['queued'] })).total).toBe(4);
        const side = await engine.dispatch({
            agent: 'other',
            channel: 'github',
            trigger: 'manual',
            payload: {},
        });
        await vi.waitFor(async () => expect((await store.runs.findOne(side.runId))?.status).toBe('completed'));
        for (let i = 0; i < ids.length; i++) {
            await vi.waitFor(() => expect(entered).toHaveLength(i + 1));
            releases.get(entered[i]!)!();
            await vi.waitFor(async () => expect((await store.runs.findOne(entered[i]!))?.status).toBe('completed'));
        }
        expect(peak).toBe(1);
        expect((await store.runs.find({ agent: 'triage', status: ['completed'] })).total).toBe(5);
        const invalid = await deliver(app, {
            event: 'issues',
            delivery: 'invalid',
            body: BODY,
            secret: 'wrong-secret',
        });
        expect(invalid.status).toBe(401);
        expect((await store.runs.find({ agent: 'triage' })).total).toBe(5);
        expect(errors).toEqual([]);
    });
});
