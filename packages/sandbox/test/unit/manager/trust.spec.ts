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

async function taint(tools: ToolSet, name: string, input: unknown): Promise<boolean | undefined> {
    const { taint: classify } = (tools[name] as Tool & { trust: ToolTrust }).trust;

    return typeof classify === 'function' ? classify(input, toolContext('r1')) : classify;
}

describe('workspace tool trust classification', () => {
    it('classifies instructions returned at creation and on demand, and marks pushes outbound', async () => {
        const manager = createWorkspaceManager({ provider: createFakeProvider() });
        const tools = manager.tools();
        const { workspace: repo } = await manager.acquire('r1', { repo: 'octo/demo' });
        const { workspace: empty } = await manager.acquire('r1', {});

        try {
            expect(await taint(tools, 'create_workspace', { repo: 'octo/demo' })).toBe(true);
            expect(await taint(tools, 'create_workspace', {})).toBe(false);
            expect(await taint(tools, 'read_repository_instructions', { workspace: repo.id })).toBe(true);
            expect(await taint(tools, 'read_repository_instructions', { workspace: empty.id })).toBe(false);
            expect(await taint(tools, 'git_fetch', {})).toBe(true);
            expect(await taint(tools, 'git_pull', {})).toBe(true);
            expect((tools.git_push as Tool & { trust: ToolTrust }).trust).toMatchObject({ taint: true, guardWhenTainted: true });
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
                        trust: { guardWhenTainted: true },
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

    it.each([0, 1])('git_push taints initially clean runs on exit %i before subsequent outbound calls', async (exitCode) => {
        let pushes = 0;
        let writes = 0;
        const stdout = 'remote hook stdout: untrusted instructions';
        const stderr = 'remote hook stderr: untrusted instructions';
        const provider = createFakeProvider({
            onExec(argv) {
                if (argv.includes('push')) {
                    pushes++;

                    return {
                        exitCode,
                        stdout,
                        stderr,
                    };
                }

                return argv.includes('rev-parse') ? { stdout: `${'1'.repeat(40)}\n` } : {};
            },
        });
        const manager = createWorkspaceManager({ provider, push: { mode: 'auto', allowBranch: () => true } });
        const store = createMemoryStore();
        const model = mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'create_workspace',
                    input: {},
                }],
            },
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'git_push',
                    input: { remote: 'octo/demo', branch: 'feature' },
                }],
            },
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'git_push',
                    input: { remote: 'octo/demo', branch: 'feature' },
                }],
            },
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'send',
                    input: {},
                }],
            },
            { parts: [{ type: 'text', text: 'done' }] },
        ]);
        const agent = defineAgent({
            name: 'test',
            instructions: 'test',
            trust: { onTainted: 'deny' },
            model,
            tools: {
                ...manager.tools(),
                send: defineTool({
                    inputSchema: z.object({}),
                    trust: { guardWhenTainted: true },
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

            expect(run?.taint).toEqual({ at: expect.any(Date), source: 'tool:git_push' });
            expect(run?.status).toBe('completed');
            expect(JSON.stringify(model.doStreamCalls)).toContain(stdout);
            expect(JSON.stringify(model.doStreamCalls)).toContain(stderr);
            expect(pushes).toBe(1);
            expect(writes).toBe(0);
        } finally {
            engine.stop();
        }
    });

    it('git_push does not execute when tainted before remote output is exposed', async () => {
        let pushes = 0;
        const provider = createFakeProvider({
            onExec(argv) {
                if (argv.includes('push')) {
                    pushes++;
                }

                return {};
            },
        });
        const manager = createWorkspaceManager({ provider, push: { mode: 'auto', allowBranch: () => true } });
        const store = createMemoryStore();
        const agent = defineAgent({
            name: 'test',
            instructions: 'test',
            trust: { onTainted: 'deny' },
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'create_workspace',
                        input: {},
                    }],
                },
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'read_untrusted',
                        input: {},
                    }],
                },
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'git_push',
                        input: { remote: 'octo/demo', branch: 'feature' },
                    }],
                },
                { parts: [{ type: 'text', text: 'done' }] },
            ]),
            tools: {
                ...manager.tools(),
                read_untrusted: defineTool({
                    inputSchema: z.object({}),
                    trust: { taint: true },
                    execute: async () => 'external text',
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

            expect(run?.taint).toEqual({ at: expect.any(Date), source: 'tool:read_untrusted' });
            expect(run?.status).toBe('completed');
            expect(pushes).toBe(0);
        } finally {
            engine.stop();
        }
    });

    describe.each(['git_fetch', 'git_pull'])('%s outbound targets', (name) => {
        it.each([
            { remote: undefined, allowed: true },
            { remote: 'octo/demo', allowed: true },
            { remote: 'https://github.com/octo/demo/', allowed: true },
            { remote: 'https://other.example/octo/demo.git', allowed: false },
            // A non-origin repository can have the tracking name "origin".
            { remote: 'https://other.example/origin', allowed: false },
            { remote: 'https://127.0.0.1/private/repo', allowed: false },
        ])('denies tainted non-origin requests but exempts origin: $remote', async ({ remote, allowed }) => {
            let network = 0;
            const provider = createFakeProvider({
                onExec(argv) {
                    if (argv.includes('fetch') || argv.includes('ls-remote')) {
                        network++;
                    }

                    return {};
                },
            });
            const manager = createWorkspaceManager({
                provider,
                repositoryInstructions: false,
                gcIntervalMs: 0,
            });
            const store = createMemoryStore();
            const call = (toolName: string, input: unknown = {}) => ({
                parts: [{
                    type: 'tool-call' as const,
                    toolName,
                    input,
                }],
            });
            const engine = new Engine({
                store,
                agents: [defineAgent({
                    name: 'test',
                    instructions: 'test',
                    trust: { onTainted: 'deny' },
                    model: mockModel([
                        call('create_workspace', { repo: 'octo/demo' }),
                        call('read'),
                        call(name, { ...(remote === undefined ? {} : { remote }), branch: 'main' }),
                        { parts: [{ type: 'text', text: 'done' }] },
                    ]),
                    tools: {
                        ...manager.tools(),
                        read: defineTool({
                            inputSchema: z.object({}),
                            trust: { taint: true },
                            execute: async () => 'untrusted instructions',
                        }),
                    },
                })],
            });

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

                expect((await store.runs.findOne(runId))?.status).toBe('completed');
                expect(network).toBe(allowed ? 1 : 0);
            } finally {
                engine.stop();
            }
        });

        it.each([false, true])('waits for approval before contacting a non-origin remote (approved: %s)', async (approved) => {
            let network = 0;
            const provider = createFakeProvider({
                onExec(argv) {
                    if (argv.includes('fetch') || argv.includes('ls-remote')) {
                        network++;
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
                    toolCallId: toolName,
                    input,
                }],
            });
            const engine = new Engine({
                store,
                agents: [defineAgent({
                    name: 'test',
                    instructions: 'test',
                    model: mockModel([
                        call('create_workspace', { repo: 'octo/demo' }),
                        call(name, { remote: 'https://other.example/octo/demo.git', branch: 'main' }),
                        { parts: [{ type: 'text', text: 'done' }] },
                    ]),
                    tools: manager.tools(),
                })],
            });

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

                const waiting = await store.runs.findOne(runId);

                expect(waiting?.status).toBe('waiting');
                expect(waiting?.taint?.source).toBe('tool:create_workspace');
                expect(network).toBe(0);
                expect(waiting?.waiting?.kind).toBe('approval');

                if (waiting?.waiting?.kind !== 'approval') {
                    throw new Error('missing outbound approval');
                }

                await engine.approve(runId, { approvalId: waiting.waiting.approvalId, approved });
                await engine.idle();

                expect((await store.runs.findOne(runId))?.status).toBe('completed');
                expect(network).toBe(approved ? 1 : 0);
            } finally {
                engine.stop();
            }
        });
    });

    it('asks once for git_push in a tainted run with push.mode approve, the commit log in the private gate body', async () => {
        let pushes = 0;
        const provider = createFakeProvider({
            onExec(argv) {
                if (argv.includes('push')) {
                    pushes++;

                    return {};
                }

                if (argv.includes('rev-parse')) {
                    return argv.at(-1)?.startsWith('refs/remotes/') ? { exitCode: 1 } : { stdout: `${'1'.repeat(40)}\n` };
                }

                if (argv.includes('rev-list')) {
                    return { stdout: '1\n' };
                }

                if (argv.includes('log')) {
                    return { stdout: 'abc1234 fix the build\n' };
                }

                return {};
            },
        });
        const manager = createWorkspaceManager({
            provider,
            gcIntervalMs: 0,
            push: { mode: 'approve', allowBranch: () => true },
        });
        const store = createMemoryStore();
        const call = (toolName: string, input: unknown = {}) => ({
            parts: [{
                type: 'tool-call' as const,
                toolName,
                toolCallId: toolName,
                input,
            }],
        });
        const engine = new Engine({
            store,
            agents: [defineAgent({
                name: 'test',
                instructions: 'test',
                model: mockModel([
                    // a repo-backed create taints the run (repository instructions)
                    call('create_workspace', { repo: 'octo/demo' }),
                    call('git_push', { branch: 'feature' }),
                    { parts: [{ type: 'text', text: 'done' }] },
                ]),
                tools: manager.tools(),
            })],
        });

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

            const gate = await store.runs.findOne(runId);

            expect(gate?.status).toBe('waiting');
            expect(gate?.waiting?.approvalId).toMatch(/^bound:/);
            expect(JSON.parse(gate!.waiting!.body!)).toMatchObject({
                tool: 'git_push',
                detail: 'Push 1 commit to feature\nTo https://github.com/octo/demo.git:\nabc1234 fix the build',
            });
            expect(pushes).toBe(0);

            await engine.approve(runId, { approvalId: gate!.waiting!.approvalId, approved: true });
            await engine.idle();

            const run = await store.runs.findOne(runId);
            const waits = (await store.steps.find(runId)).filter((step) => step.kind === 'wait');

            expect(run?.status).toBe('completed');
            expect(waits).toHaveLength(1);
            expect(pushes).toBe(1);
        } finally {
            engine.stop();
            await manager.close();
        }
    });

    async function taintedPush(push: {
        mode: 'approve' | 'auto';
        channel?: string;
        allowBranch: () => boolean
    }) {
        let pushes = 0;
        const sent: string[] = [];
        const provider = createFakeProvider({
            onExec(argv) {
                if (argv.includes('push')) {
                    pushes++;

                    return {};
                }

                if (argv.includes('rev-parse')) {
                    return argv.at(-1)?.startsWith('refs/remotes/') ? { exitCode: 1 } : { stdout: `${'1'.repeat(40)}\n` };
                }

                if (argv.includes('rev-list')) {
                    return { stdout: '1\n' };
                }

                if (argv.includes('log')) {
                    return { stdout: 'abc1234 fix the build\n' };
                }

                return {};
            },
        });
        const manager = createWorkspaceManager({
            provider,
            gcIntervalMs: 0,
            push,
        });
        const store = createMemoryStore();
        const call = (toolName: string, input: unknown = {}) => ({
            parts: [{
                type: 'tool-call' as const,
                toolName,
                toolCallId: toolName,
                input,
            }],
        });
        const engine = new Engine({
            store,
            channels: [{
                name: 'ops',
                out: async (message) => {
                    sent.push(message.kind);
                },
            }],
            agents: [defineAgent({
                name: 'test',
                instructions: 'test',
                model: mockModel([
                    call('create_workspace', { repo: 'octo/demo' }),
                    call('git_push', { branch: 'feature' }),
                    { parts: [{ type: 'text', text: 'done' }] },
                ]),
                tools: manager.tools(),
            })],
        });

        manager.attach(engine);
        await engine.start();

        const { runId } = await engine.dispatch({
            agent: 'test',
            channel: 'http',
            trigger: 'test',
            payload: {},
        });

        await engine.idle();

        return {
            engine,
            manager,
            store,
            runId,
            sent,
            pushes: () => pushes,
        };
    }

    it('never asks the gate for a git_push the push policy refuses in a tainted run', async () => {
        const t = await taintedPush({ mode: 'approve', allowBranch: () => false });

        try {
            const run = await t.store.runs.findOne(t.runId);
            const steps = await t.store.steps.find(t.runId);

            expect(run?.status).toBe('completed');
            expect(steps.filter((step) => step.kind === 'wait')).toHaveLength(0);
            expect(steps.find((step) => step.name === 'git_push')?.error).toMatchObject({ code: 'tool_denied' });
            expect(t.pushes()).toBe(0);
        } finally {
            t.engine.stop();
            await t.manager.close();
        }
    });

    it('answers a tainted git_push with push.channel through the gate only, never asking push.channel', async () => {
        const t = await taintedPush({
            mode: 'approve',
            channel: 'ops',
            allowBranch: () => true,
        });

        try {
            const gate = await t.store.runs.findOne(t.runId);

            expect(gate?.waiting?.approvalId).toMatch(/^bound:/);
            expect(gate?.waiting?.channel).toBeUndefined();

            await t.engine.approve(t.runId, { approvalId: gate!.waiting!.approvalId, approved: true });
            await t.engine.idle();

            expect((await t.store.runs.findOne(t.runId))?.status).toBe('completed');
            expect(t.sent).toEqual([]);
            expect(t.pushes()).toBe(1);
        } finally {
            t.engine.stop();
            await t.manager.close();
        }
    });

    it('does not taint workspace creation when repository instructions are disabled', async () => {
        const manager = createWorkspaceManager({ provider: createFakeProvider(), repositoryInstructions: false });
        const tools = manager.tools();

        expect(await taint(tools, 'create_workspace', { repo: 'octo/demo' })).toBe(false);
        expect(tools.read_repository_instructions).toBeUndefined();
    });
});
