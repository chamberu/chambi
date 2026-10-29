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
    MemoryConversationStore,
    MemoryStore,
    defineAgent,
} from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';

const engines: Engine[] = [];
afterEach(async () => {
    const pending = engines.map((engine) => engine.stop());
    engines.length = 0;
    await Promise.all(pending);
});
const target = {
    account: 'main',
    chat: 'private',
    audience: 'owner',
    text: 'first question',
};
function setup(name: string, key: string | undefined, store: MemoryStore, conversations: MemoryConversationStore) {
    const model = mockModel([{ parts: [{ type: 'text', text: 'answer' }] }]);
    const authorize = vi.fn(() => true);
    const channel = { name: 'chat' };
    const agent = defineAgent({
        name,
        model,
        instructions: 'help',
        conversation: key === undefined ? true : { key },
    });
    const engine = new Engine({
        store,
        agents: [agent],
        channels: [channel],
        conversations: { store: conversations, authorize },
    });
    engines.push(engine);
    return {
        engine,
        model,
        authorize,
        ctx: engine.channelContext(channel),
    };
}
async function dispatch(s: ReturnType<typeof setup>, name: string, text: string, idempotencyKey?: string) {
    return s.ctx.dispatchConversation({
        agent: name,
        trigger: 'message',
        payload: text,
        idempotencyKey,
    }, { ...target, text });
}
describe('stable conversation identity', () => {
    it('recalls the same history after an agent rename and authorizes the actual agent', async () => {
        const store = new MemoryStore(); const conversations = new MemoryConversationStore();
        const first = setup('old-helper', 'support', store, conversations);
        const initial = await dispatch(first, 'old-helper', 'first question', 'event-1');
        await first.engine.start(); await first.engine.idle(); await first.engine.stop();
        const renamed = setup('new-helper', 'support', store, conversations);
        expect(await dispatch(renamed, 'new-helper', 'retry', 'event-1')).toEqual({ runId: initial.runId, deduplicated: true });
        const next = await dispatch(renamed, 'new-helper', 'second question', 'event-2');
        await renamed.engine.start(); await renamed.engine.idle();
        expect((await store.getRun(next.runId))?.status).toBe('completed');
        expect(JSON.stringify(renamed.model.doStreamCalls[0]?.prompt)).toContain('first question');
        expect(renamed.authorize).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'new-helper',
            operation: 'dispatch',
            identity: expect.objectContaining({ agent: 'support' }),
        }));
        expect(renamed.authorize).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'new-helper',
            operation: 'recall',
            identity: expect.objectContaining({ agent: 'support' }),
        }));
    });
    it('rejects access by the renamed agent before disclosing or deduplicating prior runs', async () => {
        const store = new MemoryStore(); const conversations = new MemoryConversationStore();
        const first = setup('old-helper', 'support', store, conversations);
        await dispatch(first, 'old-helper', 'private history', 'event');
        const renamed = setup('new-helper', 'support', store, conversations);
        renamed.authorize.mockReturnValue(false);
        await expect(dispatch(renamed, 'new-helper', 'retry', 'event')).rejects.toThrow('denied');
        expect((await store.listRuns({})).total).toBe(1);
        expect(renamed.model.doStreamCalls).toHaveLength(0);
    });
    it('refuses queued work after its agent changes memory key', async () => {
        const store = new MemoryStore(); const conversations = new MemoryConversationStore();
        const initial = setup('helper', 'old-key', store, conversations);
        const queued = await dispatch(initial, 'helper', 'old input');
        const changed = setup('helper', 'new-key', store, conversations);
        await changed.engine.start(); await changed.engine.idle();
        expect((await store.getRun(queued.runId))?.status).toBe('failed');
        expect(changed.model.doStreamCalls).toHaveLength(0);
    });
    it('defaults to agent name and keeps different keys and chat targets isolated', async () => {
        const store = new MemoryStore(); const conversations = new MemoryConversationStore();
        const first = setup('old-helper', undefined, store, conversations);
        const a = await dispatch(first, 'old-helper', 'private history');
        await first.engine.start(); await first.engine.idle(); await first.engine.stop();
        const second = setup('new-helper', undefined, store, conversations);
        const b = await dispatch(second, 'new-helper', 'new question');
        await second.engine.start(); await second.engine.idle();
        expect((await store.getRun(a.runId))?.conversation?.scope.identity.agent).toBe('old-helper');
        expect((await store.getRun(b.runId))?.conversation?.scope.identity.agent).toBe('new-helper');
        expect(JSON.stringify(second.model.doStreamCalls[0]?.prompt)).not.toContain('private history');
        const otherChat = await second.ctx.dispatchConversation({
            agent: 'new-helper',
            trigger: 'message',
            payload: 'other',
        }, { ...target, chat: 'other' });
        expect((await store.getRun(otherChat.runId))?.conversation?.scope.id).not.toBe((await store.getRun(b.runId))?.conversation?.scope.id);
    });
});
