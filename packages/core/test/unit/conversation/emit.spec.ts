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
import { jsonSchema } from 'ai';
import {
    Engine,
    MemoryConversationStore,
    MemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { IChannel, ToolContext } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';

const target = {
    account: 'main',
    chat: 'private',
    audience: 'direct',
    text: 'hello',
};
const identity = {
    agent: 'helper',
    channel: 'chat',
    account: 'main',
    chat: 'private',
    audience: 'direct',
};
const engines: Engine[] = [];
afterEach(async () => {
    const pending = engines.map((engine) => engine.stop());
    engines.length = 0;
    await Promise.all(pending);
    vi.restoreAllMocks();
});
function setup(
    action: (context: ToolContext) => Promise<unknown> = async (ctx) => ctx.channels.findOneOrFail().emit({ body: 'actual reply' }),
    clock?: ControllableClock,
) {
    const store = new MemoryStore({ clock }); const conversations = new MemoryConversationStore({ clock });
    const out = vi.fn<NonNullable<IChannel['out']>>(async () => {}); const other = vi.fn<NonNullable<IChannel['out']>>(async () => {});
    const channel = { name: 'chat', out }; const alternate = {
        name: 'other',
        defaultAddress: 'elsewhere',
        out: other,
    };
    const tool = defineTool({ inputSchema: jsonSchema<{}>({ type: 'object' }), execute: async (_input, { context }) => action(context) });
    const model = mockModel([{
        parts: [{
            type: 'tool-call',
            toolName: 'reply',
            input: {},
        }],
    }, { parts: [{ type: 'text', text: 'model output is not a reply' }] }, { parts: [{ type: 'text', text: 'second result' }] }]);
    const errors: unknown[] = [];
    const engine = new Engine({
        store,
        clock,
        agents: [defineAgent({
            name: 'helper',
            instructions: 'help',
            conversation: true,
            model,
            tools: { reply: tool },
        })],
        channels: [channel, alternate],
        conversations: { store: conversations, authorize: () => true },
        onError: (e) => { errors.push(e); },
    });
    engines.push(engine);
    return {
        engine,
        store,
        conversations,
        model,
        out,
        other,
        errors,
        ctx: engine.channelContext(channel),
    };
}
async function run(s: ReturnType<typeof setup>) {
    const { runId } = await s.ctx.dispatchConversation({
        agent: 'helper',
        trigger: 'message',
        payload: target.text,
        address: 'source',
    }, target);
    await s.engine.start(); await s.engine.idle(); return runId;
}
async function items(s: ReturnType<typeof setup>) {
    const scope = (await s.conversations.get(identity))!;
    return (await s.conversations.listItems(scope, { limit: 100, offset: 0 })).data;
}

describe('source emit journal', () => {
    it('malformed custom keys cannot alias UTF-8 effect keys and invent a sent reply', async () => {
        let rejected = false;
        const s = setup(async (ctx) => {
            const handle = ctx.channels.findOneOrFail();
            try { await handle.emit({ body: 'invalid key reply', key: '\ud800' }); } catch { rejected = true; }
            await handle.emit({ body: 'legitimate reply', key: '\ufffd' });
        });
        const get = s.store.getEffect.bind(s.store); const put = s.store.putEffect.bind(s.store);
        const wire = (key: string) => Buffer.from(key, 'utf8').toString('utf8');
        vi.spyOn(s.store, 'getEffect').mockImplementation((key) => get(wire(key)));
        vi.spyOn(s.store, 'putEffect').mockImplementation((key, value) => put(wire(key), value));
        await run(s);
        expect(rejected).toBe(true);
        expect(s.out.mock.calls.map(([message]) => message.body)).toEqual(['legitimate reply']);
        expect((await items(s)).filter((item) => item.role === 'assistant')).toMatchObject([{ text: 'legitimate reply', status: 'sent' }]);
    });
    it('parallel off-source custom key collision rejects the source caller', async () => {
        const gate = Promise.withResolvers<void>();
        const s = setup(async (ctx) => {
            const handle = ctx.channels.findOneOrFail();
            const offSource = handle.emit({ body: 'elsewhere', key: 'shared' }, 'elsewhere');
            await vi.waitFor(() => expect(s.out).toHaveBeenCalledTimes(1));
            const source = handle.emit({ body: 'never sent', key: 'shared' });
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            gate.resolve();
            await offSource;
            await expect(source).rejects.toMatchObject({ code: 'validation_error' });
        });
        s.out.mockImplementationOnce(async () => gate.promise);

        // Assert outside the SDK's tool-error handling as well as inside the action.
        const result = await run(s);
        const steps = await s.store.listSteps(result);
        const rejected = steps.some((step) => step.kind === 'tool' && step.error !== undefined);
        expect(rejected).toBe(false);
        expect(s.model.doStreamCalls).toHaveLength(2);
        expect(s.out).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((item) => item.role === 'assistant')).toMatchObject([{ status: 'unknown' }]);
    });
    it('drain aborts a memory transport that ignores its signal and prevents late effect writes', async () => {
        const clock = new ControllableClock(); const gate = Promise.withResolvers<void>();
        const s = setup(undefined, clock);
        s.out.mockImplementationOnce(async () => gate.promise);
        const result = await s.ctx.dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: 'hello',
            address: 'source',
        }, target);
        await s.engine.start(); await vi.waitFor(() => expect(s.out).toHaveBeenCalledTimes(1));
        let completed = false;
        const draining = s.engine.drain({ timeoutMs: 5 }).then(() => { completed = true; });
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        clock.advance(5);
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        try {
            expect(s.out.mock.calls[0]?.[2].signal.aborted).toBe(true);
            expect(completed).toBe(true);
        } finally {
            gate.resolve(); await draining;
        }
        expect((await s.store.getRun(result.runId))?.status).toBe('interrupted');
        const pending = (await items(s)).find((item) => item.role === 'assistant')!;
        expect(pending.status).toBe('pending');
        expect(await s.store.getEffect(pending.effectKey!)).toBeUndefined();
    });
    it('tool_emit_not_run_output_is_remembered and two new runs see prior reply', async () => {
        const s = setup(); await run(s);
        const second = await s.ctx.dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: 'second',
            address: 'source',
        }, { ...target, text: 'second' });
        await s.engine.idle();
        expect((await s.store.getRun(second.runId))?.status).toBe('completed');
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ text: 'actual reply', status: 'sent' }]);
        const prompt = JSON.stringify(s.model.doStreamCalls[2]?.prompt);
        expect(prompt).toContain('actual reply'); expect(prompt).not.toContain('model output is not a reply');
    });
    it('two queued messages are ordered across engines before the first reply finishes', async () => {
        const gate = Promise.withResolvers<void>();
        const first = setup(async (ctx) => { void ctx.channels.findOneOrFail().emit({ body: 'actual reply' }).catch(() => {}); });
        first.out.mockImplementationOnce(async () => gate.promise);
        const firstResult = await first.ctx.dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: 'hello',
            address: 'source',
        }, target);
        await first.engine.start(); await vi.waitFor(() => expect(first.out).toHaveBeenCalledTimes(1));
        const draining = first.engine.drain({ timeoutMs: 10000 });
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        const model = mockModel([{ parts: [{ type: 'text', text: 'second' }] }]);
        const channel = { name: 'chat' };
        const peer = new Engine({
            store: first.store,
            agents: [defineAgent({
                name: 'helper',
                model,
                instructions: 'help',
                conversation: true,
            })],
            channels: [channel],
            conversations: { store: first.conversations, authorize: () => true },
            owner: 'peer',
        });
        engines.push(peer);
        const second = await peer.channelContext(channel).dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: 'second',
            address: 'source',
        }, { ...target, text: 'second' });
        await peer.start(); await peer.idle();
        expect((await first.store.getRun(second.runId))?.status).toBe('queued');
        expect(model.doStreamCalls).toHaveLength(0);
        gate.resolve(); await draining;
        expect((await first.store.getRun(firstResult.runId))?.status).toBe('completed');
        await peer.stop(); await peer.start(); await peer.idle();
        expect((await first.store.getRun(second.runId))?.status).toBe('completed');
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('actual reply');
    });
    it('approval_notification_not_recalled', async () => {
        const s = setup(async (ctx) => ctx.channels.findOneOrFail().approve({ title: 'continue?' }));
        const id = await run(s);
        expect((await s.store.getRun(id))?.status).toBe('waiting');
        expect(s.out.mock.calls[0]?.[0].kind).toBe('approval');
        expect((await items(s)).filter((item) => item.role === 'assistant')).toHaveLength(0);
        await s.engine.cancel(id);
    });
    it('off_source_not_recalled', async () => {
        const s = setup(async (ctx) => { await ctx.channels.findOneOrFail('other').emit({ body: 'off source' }); await ctx.channels.findOneOrFail().emit({ body: 'other address' }, 'elsewhere'); });
        await run(s); expect(s.other).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toHaveLength(0);
    });
    it('prepare_failure_sends_nothing', async () => {
        const s = setup(); vi.spyOn(s.conversations, 'prepareEmit').mockRejectedValueOnce(new Error('write unavailable'));
        await run(s); expect(s.out).not.toHaveBeenCalled();
        expect((await items(s)).filter((i) => i.role === 'assistant')).toHaveLength(0);
    });
    it('send_fail_leaves_unknown_on_terminal_reconciliation', async () => {
        const s = setup(); s.out.mockRejectedValueOnce(new Error('transport unavailable'));
        await run(s);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ status: 'unknown' }]);
    });
    it('effect_failure_after_send_stays_uncertain', async () => {
        const s = setup(); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(s.store, 'putEffect').mockRejectedValueOnce(new Error('effect write unavailable'));
        await run(s); expect(s.out).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ status: 'unknown' }]);
        expect(JSON.stringify(log.mock.calls)).not.toContain('actual reply');
    });
    it('effect_record_reconciles_confirm_failure_without_send', async () => {
        const s = setup(async (ctx) => { const handle = ctx.channels.findOneOrFail(); try { await handle.emit({ body: 'actual reply', key: 'fixed' }); } catch { /* retry the persisted effect below */ } await handle.emit({ body: 'actual reply', key: 'fixed' }); });
        vi.spyOn(s.conversations, 'confirmEmit').mockRejectedValueOnce(new Error('confirm write unavailable'));
        await run(s); expect(s.out).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ text: 'actual reply', status: 'sent' }]);
    });
    it('an off-source effect with the same custom key cannot confirm a source send', async () => {
        let refused = false;
        const s = setup(async (ctx) => {
            const handle = ctx.channels.findOneOrFail();
            await handle.emit({ body: 'elsewhere', key: 'shared' }, 'elsewhere');
            try { await handle.emit({ body: 'source reply never sent', key: 'shared' }); } catch { refused = true; }
        });
        await run(s);
        expect(refused).toBe(true);
        expect(s.out).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ status: 'unknown' }]);
    });
    it('parallel_identical_emit_one_item', async () => {
        const s = setup(async (ctx) => { const handle = ctx.channels.findOneOrFail(); await Promise.all([handle.emit({ body: 'reply' }), handle.emit({ body: 'reply' })]); });
        await run(s); expect(s.out).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toHaveLength(1);
    });
    it('same_key_different_body_refused', async () => {
        let rejected = false;
        const s = setup(async (ctx) => { const handle = ctx.channels.findOneOrFail(); await handle.emit({ body: 'first', key: 'fixed' }); try { await handle.emit({ body: 'collision', key: 'fixed' }); } catch { rejected = true; } });
        await run(s); expect(rejected).toBe(true); expect(s.out).toHaveBeenCalledTimes(1);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ text: 'first' }]);
    });
    it('mutation of ctx.run cannot redirect source capture', async () => {
        const s = setup(async (ctx) => { ctx.run.trigger.address = 'forged'; ctx.run.trigger.channel = 'other'; ctx.run.runId = 'forged'; await ctx.channels.findOneOrFail('chat').emit({ body: 'actual reply' }); });
        const id = await run(s);
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{
            runId: id,
            text: 'actual reply',
            target: { channel: 'chat', address: 'source' },
        }]);
        expect(s.out.mock.calls[0]?.[0]).toHaveProperty('runId', id);
        expect(s.out.mock.calls[0]?.[1]).toBe('source');
    });
    it('terminal_capture_failure_keeps_owner until lazy repair', async () => {
        const s = setup(); vi.spyOn(s.conversations, 'endTurn').mockRejectedValueOnce(new Error('release write unavailable'));
        const id = await run(s); const scope = (await s.conversations.get(identity))!;
        expect(await s.conversations.activeRun(scope)).toBe(id);
        expect(s.errors).toHaveLength(1);
        await expect(s.engine.resetConversation(identity)).resolves.toHaveProperty('generation', 1);
    });
    it('stored_cancel_reconciles_before_release', async () => {
        const s = setup(); const { runId } = await s.ctx.dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: 'hello',
            address: 'source',
        }, target);
        const scope = (await s.conversations.get(identity))!;
        const limits = {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 999999,
            maxStoredItems: 1000,
        };
        await s.conversations.beginTurn(scope, runId, 'hello', limits);
        await s.conversations.prepareEmit(scope, {
            id: 'pending',
            runId,
            role: 'assistant',
            status: 'pending',
            text: 'recorded send',
            effectKey: 'effect',
            target: { channel: 'chat', address: 'source' },
            createdAt: new Date(),
        });
        await s.store.putEffect('effect', { channel: 'chat', address: 'source' });
        await s.engine.cancel(runId);
        expect(await s.conversations.activeRun(scope)).toBeUndefined();
        expect((await items(s)).find((i) => i.id === 'pending')?.status).toBe('sent');
        expect(s.out).not.toHaveBeenCalled();
    });
    it('stop_does_not_pretend_flush_cancels_send', async () => {
        const gate = Promise.withResolvers<void>();
        const s = setup(async (ctx) => { void ctx.channels.findOneOrFail().emit({ body: 'in flight' }).catch(() => {}); });
        s.out.mockImplementation(async () => gate.promise);
        const result = await s.ctx.dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: 'hello',
            address: 'source',
        }, target);
        await s.engine.start(); await vi.waitFor(() => expect(s.out).toHaveBeenCalledTimes(1));
        await s.engine.stop();
        const scope = (await s.conversations.get(identity))!;
        expect(await s.conversations.activeRun(scope)).toBe(result.runId);
        gate.resolve(); await s.engine.idle();
        expect((await items(s)).filter((i) => i.role === 'assistant')).toMatchObject([{ status: 'sent' }]);
    });
});
