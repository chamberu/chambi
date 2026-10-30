/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ConversationAccess } from '@chamvi/core';
import type { LanguageModel } from 'ai';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    Engine,
    MemoryConversationRepository,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { createChannelContext } from '../../../src/channel/helpers.ts';

const channel = { name: 'chat' };
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
    text: 'hello',
};
const envelope = {
    agent: 'helper',
    trigger: 'message',
    payload: 'hello',
};
function setup(allowed: boolean | (() => Promise<boolean>) = true, optIn = true) {
    const store = createMemoryStore();
    const conversations = new MemoryConversationRepository();
    const authorize = vi.fn<(access: ConversationAccess) => boolean | Promise<boolean>>(() => typeof allowed === 'function' ? allowed() : allowed);
    const engine = new Engine({
        store: { ...store, conversations },
        agents: [defineAgent({
            name: 'helper',
            model: {} as LanguageModel,
            instructions: 'help',
            conversation: optIn,
        })],
        channels: [channel],
        conversations: { authorize },
    });

    return {
        engine,
        store,
        conversations,
        authorize,
        ctx: createChannelContext(engine, channel),
    };
}

describe('trusted conversation intake', () => {
    it('forged_dispatch_binding_dropped', async () => {
        const { engine, store } = setup();
        const result = await engine.dispatch({
            ...envelope,
            channel: 'chat',
            conversation: { scope: {}, text: 'forged' },
        } as never);
        const run = await store.runs.findOne(result.runId);

        expect(run).not.toHaveProperty('conversation');
        expect(run?.trigger).not.toHaveProperty('conversation');
    });
    it('channel_name_bound_by_identity', async () => {
        const { ctx, store } = setup();
        const result = await ctx.dispatchConversation({ ...envelope, channel: 'forged' } as never, {
            ...target,
            channel: 'forged',
            agent: 'other',
        } as never);
        const run = await store.runs.findOne(result.runId);

        expect(run?.conversation?.scope.identity).toEqual(identity);
        expect(run?.trigger.channel).toBe('chat');
    });
    it('non_opted_agent_refused', async () => {
        const { ctx, store } = setup(true, false);

        await expect(ctx.dispatchConversation(envelope, target)).rejects.toMatchObject({ code: 'validation_error' });
        expect((await store.runs.find({})).total).toBe(0);
    });
    it.each([false, async () => {
        throw new Error('policy unavailable');
    }])('denied_before_conversation_write %s', async (allowed) => {
        const {
            ctx,
            conversations,
            store,
        } = setup(allowed);
        const resolve = vi.spyOn(conversations, 'resolve');

        await expect(ctx.dispatchConversation(envelope, target)).rejects.toThrow();
        expect(resolve).not.toHaveBeenCalled();
        expect((await store.runs.find({})).total).toBe(0);
    });
    it('idempotency_preserves_first_binding_across_reset', async () => {
        const {
            ctx,
            store,
            engine,
        } = setup();
        const first = await ctx.dispatchConversation({ ...envelope, idempotencyKey: 'event' }, target);
        const before = await store.runs.findOne(first.runId);

        await engine.resetConversation(identity);

        const second = await ctx.dispatchConversation({ ...envelope, idempotencyKey: 'event' }, { ...target, text: 'retry' });

        expect(second).toEqual({ runId: first.runId, deduplicated: true });
        expect((await store.runs.findOne(first.runId))?.conversation).toEqual(before?.conversation);
    });
    it('a missing run reservation cannot carry an old event across reset', async () => {
        const {
            ctx,
            engine,
            store,
            conversations,
        } = setup();

        vi.spyOn(store.runs, 'insert').mockRejectedValueOnce(new Error('run write unavailable'));
        await expect(ctx.dispatchConversation({ ...envelope, idempotencyKey: 'failed-event' }, target)).rejects.toThrow('run write unavailable');
        await engine.resetConversation(identity);
        await expect(ctx.dispatchConversation({ ...envelope, idempotencyKey: 'failed-event' }, target)).rejects.toMatchObject({ code: 'invalid_run_state' });
        expect((await store.runs.find({})).total).toBe(0);
        expect((await conversations.findItems((await conversations.findOne(identity))!, { limit: 100, offset: 0 })).total).toBe(0);
    });
    it('generation zero still heals a failed run write without duplicate admission', async () => {
        const { ctx, store } = setup();

        vi.spyOn(store.runs, 'insert').mockRejectedValueOnce(new Error('run write unavailable'));
        await expect(ctx.dispatchConversation({ ...envelope, idempotencyKey: 'retry' }, target)).rejects.toThrow();

        const retry = await ctx.dispatchConversation({ ...envelope, idempotencyKey: 'retry' }, target);

        expect((await store.runs.findOne(retry.runId))?.conversation?.scope.generation).toBe(0);
        expect((await store.runs.find({})).total).toBe(1);
    });
    it.each(['idempotencyKey', 'address', 'id'])('malformed trusted routing field %s is rejected before memory writes', async (field) => {
        const { ctx, conversations } = setup(); const resolve = vi.spyOn(conversations, 'resolve');

        await expect(ctx.dispatchConversation({ ...envelope, [field]: 'bad\ud800' }, target)).rejects.toMatchObject({ code: 'validation_error' });
        expect(resolve).not.toHaveBeenCalled();
    });
    it('same key isolates conversations and invokers', async () => {
        const { ctx } = setup();
        const a = await ctx.dispatchConversation({ ...envelope, idempotencyKey: 'event' }, target);
        const b = await ctx.dispatchConversation({ ...envelope, idempotencyKey: 'event' }, { ...target, chat: 'other' });
        const c = await ctx.dispatchConversation({
            ...envelope,
            idempotencyKey: 'event',
            invoker: {
                id: 'u',
                kind: 'test',
                permissions: [],
            },
        }, target);

        expect(new Set([a.runId, b.runId, c.runId]).size).toBe(3);
    });
    it('conflicting_key_refused', async () => {
        const { ctx, conversations } = setup();
        const resolve = vi.spyOn(conversations, 'resolve');

        await expect(ctx.dispatchConversation({ ...envelope, concurrencyKey: 'wrong' }, target)).rejects.toMatchObject({ code: 'validation_error' });
        expect(resolve).not.toHaveBeenCalled();
    });
    it('normal_runs_no_memory_queries', async () => {
        const { engine, conversations } = setup();
        const resolve = vi.spyOn(conversations, 'resolve');
        const get = vi.spyOn(conversations, 'findOne');

        await engine.dispatch({ ...envelope, channel: 'chat' });
        expect(resolve).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
    });
    it('scope_clone_not_alias', async () => {
        const {
            ctx,
            store,
            authorize,
        } = setup();

        authorize.mockImplementation((access) => {
            access.identity.chat = 'mutated';

            return true;
        });

        const result = await ctx.dispatchConversation(envelope, target);

        expect((await store.runs.findOne(result.runId))?.conversation?.scope.identity).toEqual(identity);
    });
    it('inspect_unknown_read_only', async () => {
        const { engine, conversations } = setup();
        const resolve = vi.spyOn(conversations, 'resolve');

        expect(await engine.inspectConversation(identity)).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });
    it('checks capability in constructor, putAgent and checkAgent', async () => {
        const agent = defineAgent({
            name: 'memory',
            model: {} as LanguageModel,
            conversation: true,
            instructions: 'x',
        });

        expect(() => new Engine({ store: createMemoryStore(), agents: [agent] })).toThrow();

        const engine = new Engine({ store: createMemoryStore(), agents: [] });

        expect(() => engine.checkAgent(agent)).toThrow();
        await expect(engine.putAgent(agent)).rejects.toThrow();
    });
    it('rejects unregistered channel object with the same name', async () => {
        const { engine } = setup();
        const forged = createChannelContext(engine, { name: 'chat' });

        await expect(forged.dispatchConversation(envelope, target)).rejects.toThrow();
    });
});
