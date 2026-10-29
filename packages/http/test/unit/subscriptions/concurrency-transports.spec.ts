/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Engine,
    createMemoryStores,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import {
    createHttpApp,
    http,
    httpChannel,
    mcpChannel,
} from '@chamvi/http';
import { ControllableClock } from '@chamvi/test-kit';
import { MockLanguageModelV4 } from 'ai/test';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import { ADMIN_TOKEN, call, testAuth } from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';
import { mockModel } from '../../utils/model.ts';

let engine: Engine | undefined;
afterEach(async () => {
    await engine?.drain({ timeoutMs: 0 });
    engine = undefined;
});

describe('HTTP subscription execution cap', () => {
    it('shares one subscription slot between REST and MCP transport runs', async () => {
        const clock = new ControllableClock(new Date('2026-10-28T00:00:00Z'));
        const store = createMemoryStores({ clock });
        const entered: string[] = [];
        const releases = new Map<string, () => void>();
        const errors: unknown[] = [];
        const agent = defineAgent({
            name: 'worker',
            instructions: 'Work once.',
            channels: [http.on({ concurrencyMaxRuns: 1 })],
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
                    description: 'Hold this run.',
                    inputSchema: z.object({}),
                    execute: async () => {
                        entered.push(ctx.run.runId);
                        await new Promise<void>((resolve) => {
                            releases.set(ctx.run.runId, resolve);
                            ctx.run.signal.addEventListener('abort', () => resolve(), { once: true });
                        });
                        return 'done';
                    },
                }),
            }),
        });
        engine = new Engine({
            stores: store,
            clock,
            agents: [agent],
            channels: [httpChannel(), mcpChannel()],
            onError: (error) => { errors.push(error); },
        });
        const app = createHttpApp({
            engine,
            auth: [testAuth],
            rateLimit: false,
            metrics: false,
        });
        const client = await connectMcp(app, ADMIN_TOKEN);
        try {
            await engine.start();
            const response = await call(app, 'POST', '/agents/worker/runs', { token: ADMIN_TOKEN, body: {} });
            expect(response.status).toBe(202);
            const rest = await response.json() as { runId: string };
            await vi.waitFor(() => expect(entered).toEqual([rest.runId]));
            const result = await callTool(client, 'run_worker', { waitSeconds: 0 });
            expect(result.isError).toBeFalsy();
            const mcp = result.structuredContent as { runId: string };
            expect(await store.runs.getRun(rest.runId)).toMatchObject({ trigger: { trigger: 'http', channel: 'http' } });
            expect(await store.runs.getRun(mcp.runId)).toMatchObject({ status: 'queued', trigger: { trigger: 'http', channel: 'mcp' } });
            expect(entered).toEqual([rest.runId]);
            releases.get(rest.runId)!();
            await vi.waitFor(() => expect(entered).toEqual([rest.runId, mcp.runId]));
            expect((await store.runs.getRun(rest.runId))?.status).toBe('completed');
            releases.get(mcp.runId)!();
            await engine.idle();
            expect((await store.runs.getRun(mcp.runId))?.status).toBe('completed');
            expect(errors).toEqual([]);
        } finally {
            await client.close();
        }
    });
});
