/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { defineAgent, defineTool } from '@chamvi/core';
import { z } from 'zod';
import { ADMIN_TOKEN, call, createRunTestApp } from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';
import { mockModel } from '../../utils/model.ts';

describe('automatic approvals with long provider call ids', () => {
    it.each(['REST', 'MCP'])('can be answered through %s and resume exactly once', async (transport) => {
        let writes = 0;
        const toolCallId = `call_${'x'.repeat(195)}`;
        const setup = createRunTestApp({
            engineChannels: [{ name: 'source', untrusted: true }],
            agents: [defineAgent({
                name: 'gate',
                instructions: 'test',
                model: mockModel([
                    {
                        parts: [{
                            type: 'tool-call',
                            toolName: 'send',
                            toolCallId,
                            input: { text: 'secret' },
                        }],
                    },
                    { parts: [{ type: 'text', text: 'done' }] },
                ]),
                tools: {
                    send: defineTool({
                        inputSchema: z.object({ text: z.string() }),
                        trust: { outbound: true },
                        execute: async () => {
                            writes++;

                            return 'sent';
                        },
                    }),
                },
            })],
        });

        try {
            await setup.engine.start();

            const { runId } = await setup.engine.dispatch({
                agent: 'gate',
                channel: 'source',
                trigger: 'test',
                payload: {},
            });

            await setup.engine.idle();

            const run = await setup.store.runs.findOneOrFail(runId);

            expect(run.status).toBe('waiting');
            expect(run.waiting?.toolCallId).toBe(toolCallId);
            expect(run.waiting!.approvalId.length).toBeLessThanOrEqual(255);
            expect(writes).toBe(0);

            const body = { approvalId: run.waiting!.approvalId, approved: true };

            if (transport === 'REST') {
                const response = await call(setup.app, 'POST', `/runs/${runId}/approve`, { token: ADMIN_TOKEN, body });

                expect(response.status).toBe(202);
            } else {
                const client = await connectMcp(setup.app, ADMIN_TOKEN);

                try {
                    const result = await callTool(client, 'approve_run', { runId, ...body });

                    expect(result.isError).toBeFalsy();
                    expect(result.structuredContent).toEqual({ runId, status: 'queued' });
                } finally {
                    await client.close();
                }
            }

            await setup.engine.idle();
            expect((await setup.store.runs.findOneOrFail(runId)).status).toBe('completed');
            expect(writes).toBe(1);
        } finally {
            setup.engine.stop();
        }
    });
});
