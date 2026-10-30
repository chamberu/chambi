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
import {
    Engine,
    MemoryConversationRepository,
    approve,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { jsonSchema } from 'ai';
import type { AgentDefinition, IClock, ModelMessage } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { fakeSkillRuntime } from '../../utils/skill-runtime.ts';

const identity = {
    agent: 'helper',
    channel: 'chat',
    account: 'main',
    chat: 'private',
    audience: 'direct',
};
const target = {
    account: 'main',
    chat: 'private',
    audience: 'direct',
    text: 'current',
};
const envelope = {
    agent: 'helper',
    trigger: 'message',
    payload: 'current',
};
const engines: Engine[] = [];

afterEach(async () => {
    const pending = engines.map((engine) => engine.stop());

    engines.length = 0; await Promise.all(pending);
});

function setup(options: {
    instructions?: AgentDefinition['instructions'];
    skills?: AgentDefinition['skills'];
    clock?: IClock;
    store?: ReturnType<typeof createMemoryStore>;
    conversations?: MemoryConversationRepository;
    model?: ReturnType<typeof mockModel>;
    authorize?: () => boolean;
    tools?: any;
    maxSteps?: number;
    agentConcurrencyMaxRuns?: number
} = {}) {
    const store = options.store ?? createMemoryStore({ clock: options.clock });
    const conversations = options.conversations ?? new MemoryConversationRepository({ clock: options.clock });
    const model = options.model ?? mockModel([{ parts: [{ type: 'text', text: 'answer' }] }]);
    const channel = { name: 'chat' };
    const agent = defineAgent({
        name: 'helper',
        model,
        conversation: true,
        concurrencyMaxRuns: options.agentConcurrencyMaxRuns,
        instructions: options.instructions ?? 'help',
        skills: options.skills,
        tools: options.tools,
        budget: { maxSteps: options.maxSteps ?? 5 },
    });
    const errors: unknown[] = [];
    const engine = new Engine({
        store: { ...store, conversations },
        clock: options.clock,
        agents: [agent],
        channels: [channel],
        conversations: { authorize: options.authorize ?? (() => true) },
        onError: (e) => {
            errors.push(e);
        },
    });

    engines.push(engine);

    return {
        engine,
        store,
        conversations,
        model,
        errors,
        ctx: engine.channelContext(channel),
    };
}
async function run(s: ReturnType<typeof setup>, text = 'current') {
    const { runId } = await s.ctx.dispatchConversation({ ...envelope, payload: text }, { ...target, text });

    await s.engine.start();
    await s.engine.idle();

    return runId;
}

describe('conversation execution admission', () => {
    it('keeps mixed instructions and skills before recalled history across fresh-engine approval resume', async () => {
        const instructions: AgentDefinition['instructions'] = [
            { role: 'system', content: 'configured base' },
            {
                role: 'user',
                content: [{
                    type: 'file',
                    mediaType: 'text/plain',
                    data: 'chamvi-artifact:prefix-file',
                }],
            },
            { role: 'assistant', content: 'configured example' },
            { role: 'system', content: 'configured later policy' },
        ];
        const contexts: ModelMessage[][] = [];
        let applied = 0;
        const action = defineTool({
            inputSchema: jsonSchema<{}>({ type: 'object' }),
            execute: async (_input, options) => {
                contexts.push(options.messages);
                await approve(options.context, { title: 'continue?' });
                applied++;

                return 'done';
            },
        });
        const skill = fakeSkillRuntime({
            contribution: {
                instructions: [{ role: 'system', content: 'skill catalog metadata' }],
                tools: { action },
                checkTools: () => {},
            },
        });
        const s = setup({
            instructions,
            skills: [skill.input],
            model: mockModel([{ parts: [{ type: 'text', text: 'earlier answer' }] }, {
                parts: [{
                    type: 'tool-call',
                    toolName: 'action',
                    input: {},
                }],
            }]),
        });

        await s.store.artifacts.insert({
            id: 'prefix-file',
            runId: 'fixture',
            agent: 'helper',
            mediaType: 'text/plain',
            size: 3,
            createdAt: new Date(),
        }, new Uint8Array([97, 98, 99]));
        await run(s, 'earlier conversation input');

        const id = await run(s);
        const waiting = (await s.store.runs.findOne(id))!;

        expect(waiting.status, JSON.stringify(waiting.error)).toBe('waiting');
        await s.engine.stop();

        const resumed = setup({
            store: s.store,
            conversations: s.conversations,
            instructions,
            skills: [skill.input],
            model: mockModel([{ parts: [{ type: 'text', text: 'finished' }] }]),
        });

        await resumed.engine.start();
        await resumed.engine.approve(id, { approvalId: waiting.waiting!.approvalId, approved: true });
        await resumed.engine.idle();
        expect(await s.store.runs.findOne(id)).toMatchObject({ status: 'completed', output: 'finished' });
        expect(applied).toBe(1);
        expect(contexts).toHaveLength(2);

        for (const model of [s.model.doStreamCalls[1], resumed.model.doStreamCalls[0]]) {
            const { prompt } = (model!);

            expect(prompt.map((message) => message.role).slice(0, 7)).toEqual([
                'system',
                'user',
                'assistant',
                'system',
                'system',
                'user',
                'user',
            ]);

            const serialized = JSON.stringify(prompt);
            const ordered = ['configured base', 'configured example', 'configured later policy', 'skill catalog metadata', 'earlier conversation input', 'current'];

            for (let i = 1; i < ordered.length; i++) {
                expect(serialized.indexOf(ordered[i - 1]!)).toBeLessThan(serialized.indexOf(ordered[i]!));
            }

            expect(serialized.match(/configured example/g)).toHaveLength(1);
        }

        for (const messages of contexts) {
            expect(messages[0]).toMatchObject({ role: 'user', content: [{ type: 'file', data: new Uint8Array([97, 98, 99]) }] });
            expect(messages.map((message) => message.role).slice(0, 6)).toEqual(['user', 'assistant', 'system', 'system', 'user', 'user']);
        }

        const checkpoint = await s.store.checkpoints.findOne(id);
        const scope = (await s.conversations.findOne(identity))!;

        expect(checkpoint?.conversation).toEqual({ scopeId: scope.id, generation: scope.generation });

        const persisted = JSON.stringify([
            checkpoint,
            await s.conversations.findItems(scope, { limit: 100, offset: 0 }),
            await s.conversations.beginTurn(scope, 'next-snapshot', 'next', {
                maxItems: 20,
                maxHistoryBytes: 32768,
                maxNotesBytes: 8192,
                maxItemBytes: 16384,
                retentionMs: 999999,
                maxStoredItems: 1000,
            }),
        ]);

        expect(persisted).toContain('earlier conversation input');
        expect(persisted).not.toMatch(/configured|skill catalog metadata|prefix-file|97,98,99/);
        await s.conversations.endTurn(scope, 'next-snapshot', []);
        expect(s.errors).toEqual([]);
        expect(resumed.errors).toEqual([]);
    });

    it.each([false, true])('uses accepted conversation text as the current input, keeping attachments (%s)', async (withAttachment) => {
        const s = setup();
        const text = 'What is 2 + 2?';
        const payload = { eventId: 'opaque-transport-event', privateRouting: 'transport-only' };
        const { runId } = await s.ctx.dispatchConversation({
            ...envelope,
            payload,
            ...(withAttachment ? { attachments: [{ mediaType: 'text/plain', data: new TextEncoder().encode('attachment') }] } : {}),
        }, { ...target, text });

        await s.engine.start();
        await s.engine.idle();
        expect((await s.store.runs.findOne(runId))?.status).toBe('completed');
        expect((await s.store.runs.findOne(runId))?.trigger.payload).toEqual(payload);

        const prompt = JSON.stringify(s.model.doStreamCalls[0]?.prompt);

        expect(prompt).toContain(text);
        expect(prompt).not.toContain('opaque-transport-event');
        expect(prompt).not.toContain('transport-only');

        const first = (await s.store.checkpoints.findOne(runId))?.messages[0];

        expect(first?.role).toBe('user');
        expect(first?.content).toEqual(withAttachment ? [
            { type: 'text', text },
            expect.objectContaining({ type: 'file', mediaType: 'text/plain' }),
        ] : text);
    });

    it('an approval keeps its conversation ordered while freeing the shared agent execution cap', async () => {
        const action = defineTool({
            inputSchema: jsonSchema<{}>({ type: 'object' }),
            execute: async (_input, { context }) => approve(context, { title: 'continue?' }),
        });
        const s = setup({
            agentConcurrencyMaxRuns: 1,
            tools: { action },
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'action',
                        input: {},
                    }],
                },
                { parts: [{ type: 'text', text: 'other conversation completed' }] },
            ]),
        });
        const first = await run(s);

        expect((await s.store.runs.findOne(first))?.status).toBe('waiting');

        const same = await s.ctx.dispatchConversation(envelope, target);
        const other = await s.ctx.dispatchConversation(
            { ...envelope, payload: 'other input' },
            {
                ...target,
                chat: 'other',
                text: 'other input',
            },
        );

        await s.engine.idle();
        expect((await s.store.runs.findOne(same.runId))?.status).toBe('queued');
        expect((await s.store.runs.findOne(other.runId))?.status).toBe('completed');
        expect(s.model.doStreamCalls).toHaveLength(2);
        expect(JSON.stringify(s.model.doStreamCalls[1]?.prompt)).toContain('other input');
        await s.engine.cancel(first);
    });

    it('cancelling a waiting owner immediately retries a deferred shared-memory turn without polling', async () => {
        const clock = new ControllableClock();
        const action = defineTool({
            inputSchema: jsonSchema<{}>({ type: 'object' }),
            execute: async (_input, { context }) => approve(context, { title: 'continue?' }),
        });
        const s = setup({
            clock,
            agentConcurrencyMaxRuns: 1,
            tools: { action },
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'action',
                        input: {},
                    }],
                },
                { parts: [{ type: 'text', text: 'next turn completed' }] },
            ]),
        });

        await s.engine.putAgent(defineAgent({
            name: 'peer',
            model: s.model,
            conversation: { key: 'helper' },
            instructions: 'help',
        }));

        const first = await run(s);

        expect((await s.store.runs.findOne(first))?.status).toBe('waiting');

        const begin = vi.spyOn(s.conversations, 'beginTurn');
        const next = await s.ctx.dispatchConversation({ ...envelope, agent: 'peer' }, target);

        await s.engine.idle();
        expect((await s.store.runs.findOne(next.runId))?.status).toBe('queued');
        await expect(begin.mock.results[0]?.value).resolves.toMatchObject({ kind: 'busy', runId: first });
        expect(s.model.doStreamCalls).toHaveLength(1);

        await s.engine.cancel(first);
        await s.engine.idle();

        expect((await s.store.runs.findOne(first))?.status).toBe('cancelled');
        expect((await s.store.runs.findOne(next.runId))?.status).toBe('completed');
        expect(s.model.doStreamCalls).toHaveLength(2);
        expect(clock.now()).toEqual(new Date(0));
        expect(s.errors).toEqual([]);
    });

    it('capture_uses_selected_history_at_execution_not_intake', async () => {
        const s = setup();
        const result = await s.ctx.dispatchConversation(envelope, target);
        const scope = await s.conversations.resolve(identity);

        await s.conversations.beginTurn(scope, 'previous', 'earlier input', {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 999999,
            maxStoredItems: 1000,
        });
        await s.conversations.endTurn(scope, 'previous', []);
        await s.engine.start(); await s.engine.idle();
        expect((await s.store.runs.findOne(result.runId))?.status).toBe('completed');
        expect(JSON.stringify(s.model.doStreamCalls[0]?.prompt)).toContain('earlier input');

        const cp = await s.store.checkpoints.findOne(result.runId);

        expect(cp?.conversation).toEqual({
            scopeId: scope.id,
            generation: scope.generation,
        });
    });
    it('operator reset reconciles a settled owner without admitting a fabricated turn', async () => {
        const s = setup(); const scope = await s.conversations.resolve(identity);
        const result = await s.ctx.dispatchConversation(envelope, target);

        await s.conversations.beginTurn(scope, result.runId, 'accepted', {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 999999,
            maxStoredItems: 1000,
        });
        await s.store.runs.update(result.runId, { status: 'cancelled' });
        expect(await s.conversations.activeRun(scope)).toBe(result.runId);
        await expect(s.engine.resetConversation(identity)).resolves.toHaveProperty('generation', 1);
        expect(await s.conversations.activeRun(scope)).toBeUndefined();
    });
    it('busy_requeues_without_model', async () => {
        const s = setup();
        const scope = await s.conversations.resolve(identity);

        await s.store.runs.insert({
            id: 'owner',
            agent: 'helper',
            status: 'waiting',
            trigger: {
                ...envelope,
                id: 'event',
                channel: 'chat',
                receivedAt: new Date(),
            },
            usage: { inputTokens: 0, outputTokens: 0 },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        await s.conversations.beginTurn(scope, 'owner', 'pending', {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 999999,
            maxStoredItems: 1000,
        });

        const id = await run(s);

        expect((await s.store.runs.findOne(id))?.status).toBe('queued');
        expect(s.model.doStreamCalls).toHaveLength(0);
    });
    it.each([true, false])('settled or missing owner reconciles before admission (%s)', async (exists) => {
        const s = setup(); const scope = await s.conversations.resolve(identity);

        if (exists) {
            await s.store.runs.insert({
                id: 'old',
                agent: 'helper',
                status: 'completed',
                trigger: {
                    ...envelope,
                    id: 'event',
                    channel: 'chat',
                    receivedAt: new Date(),
                },
                usage: { inputTokens: 0, outputTokens: 0 },
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }

        await s.conversations.beginTurn(scope, 'old', 'earlier', {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 999999,
            maxStoredItems: 1000,
        });

        const id = await run(s);

        expect((await s.store.runs.findOne(id))?.status).toBe('completed');
        await expect(s.engine.resetConversation(identity)).resolves.toHaveProperty('generation', 1);
    });
    it('stale_generation_fails_without_model', async () => {
        const s = setup(); const result = await s.ctx.dispatchConversation(envelope, target);

        await s.engine.resetConversation(identity);
        await s.engine.start(); await s.engine.idle();
        expect((await s.store.runs.findOne(result.runId))?.status).toBe('failed');
        expect(s.model.doStreamCalls).toHaveLength(0);
    });
    it('new_engine_restart_reuses_snapshot_before_first_step', async () => {
        const s = setup(); const result = await s.ctx.dispatchConversation(envelope, target);
        const scope = await s.conversations.resolve(identity);
        const limits = {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 999999,
            maxStoredItems: 1000,
        };

        await s.conversations.beginTurn(scope, 'previous', 'original history', limits); await s.conversations.endTurn(scope, 'previous', []);

        const first = await s.conversations.beginTurn(scope, result.runId, 'current', limits);
        const resumed = setup({ store: s.store, conversations: s.conversations });

        await resumed.engine.start(); await resumed.engine.idle();
        expect(first.kind).toBe('ready');
        expect(JSON.stringify(resumed.model.doStreamCalls[0]?.prompt)).toContain('original history');
        expect((await s.conversations.findItems(scope, { limit: 100, offset: 0 })).data.filter((i) => i.runId === result.runId)).toHaveLength(1);
    });
    it('revocation prevents even early checkpoint budget completion', async () => {
        let allowed = true;
        const s = setup({ authorize: () => allowed, maxSteps: 1 });
        const result = await s.ctx.dispatchConversation(envelope, target);

        await s.store.checkpoints.save({
            runId: result.runId,
            stepIndex: 0,
            finishReason: 'stop',
            messages: [{ role: 'assistant', content: 'old answer' }],
            createdAt: new Date(),
        });
        allowed = false;
        await s.engine.start(); await s.engine.idle();
        expect((await s.store.runs.findOne(result.runId))?.status).toBe('failed');
        expect(s.model.doStreamCalls).toHaveLength(0);
    });
    it('cancel during admission still settles and releases the admitted owner', async () => {
        const s = setup();
        const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
        const begin = s.conversations.beginTurn.bind(s.conversations);

        vi.spyOn(s.conversations, 'beginTurn').mockImplementationOnce(async (...args) => {
            entered.resolve(); await release.promise;

            return begin(...args);
        });

        const { runId } = await s.ctx.dispatchConversation(envelope, target);

        await s.engine.start(); await entered.promise;

        const cancelled = s.engine.cancel(runId);

        release.resolve(); await cancelled; await s.engine.idle();
        expect((await s.store.runs.findOne(runId))?.status).toBe('cancelled');
        expect(await s.conversations.activeRun((await s.conversations.findOne(identity))!)).toBeUndefined();
        expect(s.model.doStreamCalls).toHaveLength(0);
    });
    it('failed begin writes fail before the tools factory or model', async () => {
        const factory = vi.fn(() => ({})); const s = setup({ tools: factory });

        vi.spyOn(s.conversations, 'beginTurn').mockRejectedValueOnce(new Error('write unavailable'));

        const id = await run(s);

        expect((await s.store.runs.findOne(id))?.status).toBe('failed');
        expect(factory).not.toHaveBeenCalled(); expect(s.model.doStreamCalls).toHaveLength(0);
    });
    it('approval_resume_does_not_recall_again and revocation prevents pending tool', async () => {
        let allowed = true; let applied = 0;
        const action = defineTool({
            inputSchema: jsonSchema<{}>({ type: 'object' }),
            execute: async (_input, { context }) => {
                await approve(context, { title: 'continue?' }); applied++;

                return 'done';
            },
        });
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'action',
                input: {},
            }],
        }, { parts: [{ type: 'text', text: 'finished' }] }]);
        const s = setup({
            authorize: () => allowed,
            model,
            tools: { action },
        });
        const begin = vi.spyOn(s.conversations, 'beginTurn'); const id = await run(s);

        expect((await s.store.runs.findOne(id))?.status).toBe('waiting');

        const waiting = (await s.store.runs.findOne(id))!.waiting!;

        allowed = false;
        await s.engine.approve(id, { approvalId: waiting.approvalId, approved: true }); await s.engine.idle();
        expect((await s.store.runs.findOne(id))?.status).toBe('failed'); expect(applied).toBe(0);
        expect(model.doStreamCalls).toHaveLength(1);
        expect(begin).toHaveBeenCalledTimes(1);
    });
});
