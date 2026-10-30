/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Tool, ToolSet } from 'ai';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { ToolTrust } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import { toolContext } from '../../utils/context.ts';
import { mockModel } from '../../utils/model.ts';
import { createFakeProvider } from '../../utils/provider.ts';

async function untrustedResult(tools: ToolSet, name: string, input: unknown): Promise<boolean | undefined> {
    const { untrustedResult: classify } = (tools[name] as Tool & { trust: ToolTrust }).trust;

    return typeof classify === 'function' ? classify(input, toolContext('r1')) : classify;
}

describe('workspace tool trust classification', () => {
    it('classifies instructions returned at creation and on demand, and marks pushes outbound', async () => {
        const manager = createWorkspaceManager({ provider: createFakeProvider() });
        const tools = manager.tools();
        const { workspace: repo } = await manager.acquire('r1', { repo: 'octo/demo' });
        const { workspace: empty } = await manager.acquire('r1', {});

        try {
            expect(await untrustedResult(tools, 'create_workspace', { repo: 'octo/demo' })).toBe(true);
            expect(await untrustedResult(tools, 'create_workspace', {})).toBe(false);
            expect(await untrustedResult(tools, 'read_repository_instructions', { workspace: repo.id })).toBe(true);
            expect(await untrustedResult(tools, 'read_repository_instructions', { workspace: empty.id })).toBe(false);
            expect((tools.git_push as Tool & { trust: ToolTrust }).trust).toEqual({ outbound: true });
        } finally {
            await manager.release('r1');
        }
    });

    it.each(['git_fetch', 'git_pull'])('%s taints empty workspaces on success and errors, blocking outbound tools', async (name) => {
        for (const fails of [false, true]) {
            let fetches = 0;
            let reads = 0;
            let writes = 0;
            const provider = createFakeProvider({
                onExec(argv) {
                    if (argv.includes('fetch')) {
                        fetches++;

                        if (fails) {
                            throw new Error('remote stderr');
                        }

                        for (const workspace of provider.workspaces.values()) {
                            workspace.files.set('remote.txt', 'remote content');
                        }
                    }

                    return {};
                },
            });
            const manager = createWorkspaceManager({ provider, gcIntervalMs: 0 });
            const store = createMemoryStore();
            const call = (toolName: string, input: unknown = {}) => ({
                parts: [{
                    type: 'tool-call' as const,
                    toolName,
                    input,
                }],
            });
            const agent = defineAgent({
                name: 'test',
                instructions: 'test',
                trust: { onTainted: 'deny' },
                model: mockModel([
                    call('create_workspace'),
                    call(name, { remote: 'octo/demo', ...(name === 'git_pull' ? { branch: 'main' } : {}) }),
                    ...(fails ? [] : [call('read')]),
                    call('send'),
                    { parts: [{ type: 'text', text: 'done' }] },
                ]),
                tools: {
                    ...manager.tools(),
                    read: defineTool({
                        inputSchema: z.object({}),
                        execute: async (_input, { context }) => {
                            const workspace = await manager.get(context.run.runId);
                            const content = await workspace.readFile('remote.txt');

                            reads++;

                            return content;
                        },
                    }),
                    send: defineTool({
                        inputSchema: z.object({}),
                        trust: { outbound: true },
                        execute: async () => {
                            writes++;

                            return 'sent';
                        },
                    }),
                },
            });
            const engine = new Engine({ store, agents: [agent] });

            manager.attach(engine);

            try {
                await engine.start();

                const { runId } = await engine.dispatch({
                    agent: 'test',
                    channel: 'http',
                    trigger: 'test',
                    payload: {},
                });

                await engine.idle();

                const run = await store.runs.findOne(runId);

                expect(run?.taint).toEqual({ at: expect.any(Date), source: `tool:${name}` });
                expect(run?.status).toBe('completed');
                expect(fetches).toBe(1);
                expect(reads).toBe(fails ? 0 : 1);
                expect(writes).toBe(0);
            } finally {
                engine.stop();
            }
        }
    });

    it('does not taint workspace creation when repository instructions are disabled', async () => {
        const manager = createWorkspaceManager({ provider: createFakeProvider(), repositoryInstructions: false });
        const tools = manager.tools();

        expect(await untrustedResult(tools, 'create_workspace', { repo: 'octo/demo' })).toBe(false);
        expect(tools.read_repository_instructions).toBeUndefined();
    });
});
