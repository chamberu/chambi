/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import {
    afterAll,
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { ChamviError, InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import type {
    ChannelMessage,
    ChannelSendOptions,
    IClock,
    TriggerEnvelope,
} from '@chamvi/core';
import {
    CHAT_REQUEST_ERROR_CODE,
    CHAT_TEXT_MAX_CHARS,
    CHAT_TIMEOUT_MS,
    chatAddress,
} from '@chamvi/chat';
import { ControllableClock } from '@chamvi/test-kit';
import type { RawMessage } from 'chat';
import { createChatSender } from '../../../src/outbound/module.ts';
import type { ChatSenderOptions } from '../../../src/outbound/types.ts';
import { createFakeAdapter } from '../../utils/adapter.ts';
import type { FakeAdapter } from '../../utils/adapter.ts';

const TRIGGER: TriggerEnvelope = {
    id: 'trigger-1',
    agent: 'helper',
    trigger: 'chat',
    channel: 'chat',
    payload: { message: { text: 'trigger text that must never be sent back' } },
    receivedAt: new Date('2026-11-01T09:00:00Z'),
};

const SOURCE = chatAddress({ adapter: 'fake', threadId: 'fake:chat-1' });
const OTHER = chatAddress({ adapter: 'fake', threadId: 'fake:chat-2' });

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
};

process.on('unhandledRejection', onUnhandled);

afterEach(() => {
    unhandled = [];
});

afterAll(() => {
    process.off('unhandledRejection', onUnhandled);
});

function message(patch: Partial<ChannelMessage> = {}): ChannelMessage {
    return {
        kind: 'message',
        key: 'run-1:emit:chat:key:greeting',
        runId: 'run-1',
        agent: 'helper',
        body: 'Hello there.',
        ...patch,
    };
}

function opts(signal: AbortSignal = new AbortController().signal): ChannelSendOptions {
    return { signal, trigger: TRIGGER };
}

function setup(patch: Partial<ChatSenderOptions> = {}) {
    const adapter = createFakeAdapter();
    const clock = new ControllableClock(new Date('2026-11-01T09:00:00Z'));
    const errors: unknown[] = [];
    let online: IClock | undefined = clock;
    const out = createChatSender({
        name: 'chat',
        adapters: [adapter],
        timeoutMs: CHAT_TIMEOUT_MS,
        online: () => online,
        onError: (error) => {
            errors.push(error);
        },
        ...patch,
    });

    return {
        adapter,
        clock,
        errors,
        out,
        goOffline: () => {
            online = undefined;
        },
    };
}

/** a postMessage that stays pending until settled by hand */
function hang(adapter: FakeAdapter) {
    let pending = Promise.withResolvers<RawMessage<unknown>>();
    let calls = 0;

    adapter.postMessage = (threadId) => {
        calls += 1;
        pending = Promise.withResolvers<RawMessage<unknown>>();

        return pending.promise.then((raw) => ({ ...raw, threadId }));
    };

    return {
        get calls() {
            return calls;
        },
        resolve: () => pending.resolve({
            id: 'late',
            threadId: '',
            raw: {},
        }),
        reject: (error: unknown) => pending.reject(error),
    };
}

function flush(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('expected a rejection');
}

describe('createChatSender', () => {
    it('source_and_explicit_target: posts the rendered text as raw text to the thread the address names', async () => {
        const ctx = setup();

        await ctx.out(message(), SOURCE, opts());
        await ctx.out(message({ title: 'Note', body: 'Elsewhere.' }), OTHER, opts());

        expect(ctx.adapter.posts).toEqual([
            { threadId: 'fake:chat-1', message: { raw: 'Hello there.' } },
            { threadId: 'fake:chat-2', message: { raw: 'Note\n\nElsewhere.' } },
        ]);
    });

    it('refuses an address that is missing, malformed or of another adapter before posting', async () => {
        const ctx = setup();

        for (const address of ['', 'owner', chatAddress({ adapter: 'slack', threadId: 'C1' })]) {
            await expect(ctx.out(message(), address, opts())).rejects.toBeInstanceOf(ValidationError);
        }

        expect(ctx.adapter.posts).toEqual([]);
    });

    it('oversize_text_never_sends: refuses above CHAT_TEXT_MAX_CHARS with no post', async () => {
        const ctx = setup();
        const error = await rejection(ctx.out(message({ body: 'x'.repeat(CHAT_TEXT_MAX_CHARS + 1) }), SOURCE, opts()));

        expect(error).toBeInstanceOf(ValidationError);
        expect(ctx.adapter.posts).toEqual([]);
    });

    it('refuses an approval without approvalUrl before posting', async () => {
        const ctx = setup();
        const error = await rejection(ctx.out(message({
            kind: 'approval',
            approvalId: '0:call-1:0',
            expiresAt: new Date('2026-11-02T09:00:00Z'),
        }), SOURCE, opts()));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(ctx.adapter.posts).toEqual([]);
    });

    it('offline_fails_before_post: a channel that is not connected sends nothing and says so', async () => {
        const ctx = setup();

        ctx.goOffline();

        const error = await rejection(ctx.out(message(), SOURCE, opts()));

        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe(CHAT_REQUEST_ERROR_CODE);
        expect((error as Error).message).toMatch(/not connected/);
        expect(ctx.adapter.posts).toEqual([]);
    });

    it('an aborted signal sends nothing', async () => {
        const ctx = setup();
        const controller = new AbortController();
        const reason = new Error('drained');

        controller.abort(reason);

        await expect(ctx.out(message(), SOURCE, opts(controller.signal))).rejects.toBe(reason);
        expect(ctx.adapter.posts).toEqual([]);
    });

    it('wraps a transport failure as chat_request, without retrying', async () => {
        const ctx = setup();
        let calls = 0;

        ctx.adapter.postMessage = () => {
            calls += 1;

            return Promise.reject(new Error('socket closed'));
        };

        const error = await rejection(ctx.out(message(), SOURCE, opts()));

        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe(CHAT_REQUEST_ERROR_CODE);
        expect((error as Error).message).toMatch(/socket closed/);
        expect(calls).toBe(1);
    });

    it('wraps a synchronous transport throw the same way', async () => {
        const ctx = setup();

        ctx.adapter.postMessage = () => {
            throw new Error('not connected yet');
        };

        const error = await rejection(ctx.out(message(), SOURCE, opts()));

        expect((error as ChamviError).code).toBe(CHAT_REQUEST_ERROR_CODE);
    });

    it('deadline_or_abort_settles_send: stops waiting at the deadline on the clock; a late answer is reported, never unhandled', async () => {
        const ctx = setup({ timeoutMs: 1000 });
        const pending = hang(ctx.adapter);
        const sending = rejection(ctx.out(message(), SOURCE, opts()));

        await flush();
        expect(pending.calls).toBe(1);

        ctx.clock.advance(999);
        await flush();
        ctx.clock.advance(1);

        const error = await sending;

        expect((error as ChamviError).code).toBe(CHAT_REQUEST_ERROR_CODE);
        // honest: waiting stopped, the transport may still deliver
        expect((error as Error).message).toMatch(/1000ms/);
        expect((error as Error).message).toMatch(/may still/);

        pending.resolve();
        await flush();

        expect(ctx.errors).toHaveLength(1);
        expect((ctx.errors[0] as ChamviError).code).toBe(CHAT_REQUEST_ERROR_CODE);
        expect((ctx.errors[0] as Error).message).toMatch(/after/);
        expect(unhandled).toEqual([]);
    });

    it('deadline_or_abort_settles_send: an abort while posting rejects with its reason; a late failure stays handled', async () => {
        const ctx = setup();
        const pending = hang(ctx.adapter);
        const controller = new AbortController();
        const sending = rejection(ctx.out(message(), SOURCE, opts(controller.signal)));
        const reason = new Error('run cancelled');

        await flush();
        controller.abort(reason);

        expect(await sending).toBe(reason);

        pending.reject(new Error('late failure'));
        await flush();

        expect(unhandled).toEqual([]);
        expect(ctx.errors).toHaveLength(1);
        // the clock holds no timer of a settled send
        ctx.clock.advance(CHAT_TIMEOUT_MS * 2);
        await flush();
        expect(ctx.errors).toHaveLength(1);
    });

    it('is at-least-once: a second call with the same key posts again (no transport id seam, no exactly-once claim)', async () => {
        const ctx = setup();

        await ctx.out(message(), SOURCE, opts());
        await ctx.out(message(), SOURCE, opts());

        expect(ctx.adapter.posts).toHaveLength(2);
        // the public postMessage takes no client id: nothing carries the key
        expect(JSON.stringify(ctx.adapter.posts)).not.toContain('greeting');
    });
});
