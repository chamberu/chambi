/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


// Characterization of the external boundary (Task 1 gate), against the real npm
// packages: chat 4.43.0, chat-adapter-baileys 2.1.0, baileys 7.0.0-rc14.
// Tests prefixed "native:" record upstream behaviour as it is, limitations included;
// the others pin what the ingress facade adds on top of the public seams.

import type { Adapter, AdapterPostableMessage } from 'chat';
import { Chat } from 'chat';
import type { BaileysAdapter } from 'chat-adapter-baileys';
import { createBaileysAdapter } from 'chat-adapter-baileys';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import { createChatIngressAdapter } from '@chamvi/chat';
import type { ChatIncoming } from '@chamvi/chat';
import { bindIngress } from '../../../src/ingress/module.ts';
import { createFakeAdapter, createTextMessage } from '../../utils/adapter.ts';
import { createMemoryState, createRecordingLogger } from '../../utils/chat.ts';
import type { LoopbackTransport } from '../../utils/loopback.ts';
import { createMemoryAuthState, createSilentBaileysLogger, startLoopbackTransport } from '../../utils/loopback.ts';

function deferred(): PromiseWithResolvers<void> {
    return Promise.withResolvers<void>();
}

/** settles to 'pending' when the promise has not settled after the queued work ran */
async function stateOf(promise: Promise<unknown>): Promise<'pending' | 'fulfilled' | 'rejected'> {
    const marker = Symbol('pending');
    const settled = promise.then(() => 'fulfilled' as const, () => 'rejected' as const);

    await new Promise((resolve) => {
        setImmediate(resolve);
    });

    const result = await Promise.race([settled, Promise.resolve(marker)]);

    return result === marker ? 'pending' : result;
}

function buildChat(adapters: Record<string, Adapter>) {
    const state = createMemoryState();
    const logger = createRecordingLogger();
    const chat = new Chat({
        userName: 'chamvi',
        adapters,
        state,
        logger,
        concurrency: 'concurrent',
    });

    return {
        chat,
        state,
        logger,
    };
}

describe('chat 4.43.0 native message processing', () => {
    it('native: a handler failure after the pre-handler dedupe drops the redelivery', async () => {
        const adapter = createFakeAdapter();
        const {
            chat,
            state,
            logger,
        } = buildChat({ fake: adapter });
        let calls = 0;

        chat.onDirectMessage(async () => {
            calls += 1;

            if (calls === 1) {
                throw new Error('store down');
            }
        });
        await chat.initialize();

        const message = createTextMessage({ id: 'm-1' });

        // the returned task rejects for a caller that awaits it ...
        await expect(adapter.deliver(message)).rejects.toThrow('store down');
        // ... the SDK reports it to its logger ...
        expect(logger.records.some((record) => record.level === 'error' && record.message === 'Message processing error')).toBe(true);
        // ... and the dedupe key it claimed before the handler survives the failure,
        // so the redelivery of the same message never reaches a handler again
        await adapter.deliver(message);
        expect(calls).toBe(1);
        expect(state.claimed.filter((key) => key.includes('dedupe:fake:m-1'))).toHaveLength(2);
    });

    it('native: processMessage of a concurrent chat settles only after its handler', async () => {
        const adapter = createFakeAdapter();
        const { chat } = buildChat({ fake: adapter });
        const gate = deferred();

        chat.onDirectMessage(async () => {
            await gate.promise;
        });
        await chat.initialize();

        const task = adapter.deliver(createTextMessage({ id: 'm-1' }));

        expect(await stateOf(task)).toBe('pending');
        gate.resolve();
        await expect(task).resolves.toBeUndefined();
    });
});

describe('ingress facade over the public Adapter.initialize(chat)', () => {
    it('handler_store_failure_is_not_durable_acceptance', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat, state } = buildChat({ [ingress.name]: ingress });
        let nativeCalls = 0;

        chat.onDirectMessage(async () => {
            nativeCalls += 1;
        });

        const received: ChatIncoming[] = [];

        bindIngress(ingress, {
            async receive(incoming) {
                received.push(incoming);

                if (received.length === 1) {
                    throw new Error('store down');
                }
            },
        });
        await chat.initialize();

        const message = createTextMessage({ id: 'm-1' });

        await expect(adapter.deliver(message)).rejects.toThrow('store down');
        await expect(adapter.deliver(message)).resolves.toBeUndefined();

        // the failed message reaches the receiver again: the SDK's dedupe never ran
        expect(received).toHaveLength(2);
        expect(received[1]).toEqual({
            adapter,
            threadId: 'fake:chat-1',
            message,
        });
        expect(state.claimed).toEqual([]);
        expect(nativeCalls).toBe(0);
    });

    it('an ignored failing processMessage promise is no unhandled rejection', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat({ [ingress.name]: ingress });
        let calls = 0;

        bindIngress(ingress, {
            async receive() {
                calls += 1;

                throw new Error('store down');
            },
        });
        await chat.initialize();

        const unhandled: unknown[] = [];
        const listener = (reason: unknown) => {
            unhandled.push(reason);
        };

        process.on('unhandledRejection', listener);

        try {
            adapter.deliverIgnored(createTextMessage({ id: 'm-1' }));
            await new Promise((resolve) => {
                setTimeout(resolve, 20);
            });
        } finally {
            process.off('unhandledRejection', listener);
        }

        expect(calls).toBe(1);
        expect(unhandled).toEqual([]);
    });

    it('concurrent_message_processing_awaits_receiver', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat({ [ingress.name]: ingress });
        const gates = new Map<string, ReturnType<typeof deferred>>([
            ['m-1', deferred()],
            ['m-2', deferred()],
        ]);
        const started: string[] = [];

        bindIngress(ingress, {
            async receive({ message }) {
                started.push(message.id);
                await gates.get(message.id)?.promise;
            },
        });
        await chat.initialize();

        const first = adapter.deliver(createTextMessage({ id: 'm-1' }));
        const second = adapter.deliver(createTextMessage({ id: 'm-2' }));

        expect(await stateOf(first)).toBe('pending');
        expect(await stateOf(second)).toBe('pending');
        // both run at once on one thread: nothing serializes them before the receiver
        expect(started).toEqual(['m-1', 'm-2']);

        gates.get('m-2')?.resolve();
        await expect(second).resolves.toBeUndefined();
        expect(await stateOf(first)).toBe('pending');
        gates.get('m-1')?.resolve();
        await expect(first).resolves.toBeUndefined();
    });

    it('resolves a lazy message factory before the receiver', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat({ [ingress.name]: ingress });
        const received: string[] = [];

        bindIngress(ingress, {
            async receive({ message }) {
                received.push(message.id);
            },
        });
        await chat.initialize();

        const message = createTextMessage({ id: 'm-1' });

        await adapter.chat?.processMessage(adapter, message.threadId, async () => message);
        expect(received).toEqual(['m-1']);
    });

    it('forwards every other ChatInstance member to the real chat', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat, state } = buildChat({ [ingress.name]: ingress });

        await chat.initialize();

        expect(chat.getAdapter(ingress.name)).toBe(ingress);
        expect(adapter.chat).not.toBe(chat);
        expect(adapter.chat?.getUserName()).toBe('chamvi');
        expect(adapter.chat?.getState()).toBe(state);
    });

    it('rejects a message while no receiver is bound', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat({ [ingress.name]: ingress });

        await chat.initialize();

        const dispose = bindIngress(ingress, { receive: () => Promise.resolve() });

        dispose();

        await expect(adapter.deliver(createTextMessage({ id: 'm-1' }))).rejects.toThrow(/no receiver/);
    });
});

describe('chat-adapter-baileys 2.1.0 lifecycle over a loopback transport', () => {
    let transport: LoopbackTransport;
    let adapter: BaileysAdapter | undefined;

    beforeEach(async () => {
        transport = await startLoopbackTransport();
    });

    afterEach(async () => {
        await adapter?.disconnect();
        adapter = undefined;
        await transport.close();
    });

    function createAdapter(): BaileysAdapter {
        return createBaileysAdapter({
            auth: { state: createMemoryAuthState(), saveCreds: async () => {} },
            // a fixed version: no fetchLatestBaileysVersion() request
            version: [2, 3000, 1],
            logger: createRecordingLogger(),
            socketOptions: {
                waWebSocketUrl: transport.url,
                logger: createSilentBaileysLogger(),
            },
        });
    }

    it('native: connect() resolves before any transport opened', async () => {
        adapter = createAdapter();
        await adapter.connect();
        // nothing public tells "connecting" from "connected": botUserId is the only socket field exposed
        expect(adapter.botUserId).toBeUndefined();
    });

    it('native: a transport close reconnects immediately, with no delay or abort to configure', async () => {
        adapter = createAdapter();
        await adapter.connect();
        // a backoff of even one second would keep this at 1 attempt within the wait
        await expect.poll(() => transport.attempts, { timeout: 900, interval: 10 }).toBeGreaterThanOrEqual(5);
    });

    it('stopping_cancels_reconnect', async () => {
        adapter = createAdapter();
        await adapter.connect();
        await expect.poll(() => transport.attempts, { interval: 10 }).toBeGreaterThanOrEqual(3);

        await adapter.disconnect();
        // let the in-flight attempt fail and any reconnect fire
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });

        const stopped = transport.attempts;

        await new Promise((resolve) => {
            setTimeout(resolve, 200);
        });
        expect(transport.attempts).toBe(stopped);
    });

    it('Chat.shutdown() disconnects the wrapped adapter through the ingress', async () => {
        adapter = createAdapter();

        // 2.1.0 declares reply(message, content), chat 4.43.0's Adapter
        // reply(threadId, messageId, message): the adapter needs a cast (see below)
        const ingress = createChatIngressAdapter(adapter as unknown as Adapter);
        const { chat } = buildChat({ [ingress.name]: ingress });

        bindIngress(ingress, { receive: () => Promise.resolve() });
        await chat.initialize();
        expect(chat.getAdapter('baileys')).toBe(ingress);

        await adapter.connect();
        await expect.poll(() => transport.attempts, { interval: 10 }).toBeGreaterThanOrEqual(2);
        await chat.shutdown();
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });

        const stopped = transport.attempts;

        await new Promise((resolve) => {
            setTimeout(resolve, 200);
        });
        expect(transport.attempts).toBe(stopped);
    });

    it('native: the connection status is observable only as log text', async () => {
        const records = createRecordingLogger();

        adapter = createBaileysAdapter({
            auth: { state: createMemoryAuthState(), saveCreds: async () => {} },
            version: [2, 3000, 1],
            logger: records,
            socketOptions: { waWebSocketUrl: transport.url, logger: createSilentBaileysLogger() },
        });
        await adapter.connect();
        await expect.poll(
            () => records.records.filter((record) => record.message.startsWith('Connection closed')).length,
            { interval: 10 },
        ).toBeGreaterThanOrEqual(1);
        expect(records.records.find((record) => record.message.startsWith('Connection closed'))?.message)
            .toMatch(/^Connection closed \(code=\d+, reconnect=true\)$/);
    });

    it('native: BaileysAdapter is no chat 4.43.0 Adapter by type (reply signature)', () => {
        expectTypeOf<BaileysAdapter>().not.toExtend<Adapter>();
        expectTypeOf<Parameters<BaileysAdapter['reply']>>().not.toEqualTypeOf<Parameters<NonNullable<Adapter['reply']>>>();
    });

    it('native: the SDK reply(threadId, messageId, message) call shape fails on the 2.1.0 adapter', async () => {
        adapter = createAdapter();

        // what chat 4.43.0's Thread.reply() calls on any adapter that has a reply method
        const sdkReply = (adapter as unknown as Required<Pick<Adapter, 'reply'>>).reply.bind(adapter);

        await expect(sdkReply('baileys:MTIz', 'm-1', 'hi')).rejects.toThrow(TypeError);
    });

    // A loggedOut (401) close comes from a WhatsApp stream error after the Noise handshake;
    // 2.1.0 builds its socket with a module-level makeWASocket import and takes no transport
    // factory, so no test can make the adapter see one, and nothing public reports it.
    it.todo('logged_out_never_reconnects (blocked: no public transport seam or logged-out signal in chat-adapter-baileys 2.1.0)');

    it('native: postMessage takes no caller message id', () => {
        expectTypeOf<Parameters<BaileysAdapter['postMessage']>>().toEqualTypeOf<[string, AdapterPostableMessage]>();
    });

    // 2.1.0 generates the WhatsApp message id inside postMessage (generateMessageIDV2);
    // a caller cannot choose it before the send, and no send is possible without a paired socket.
    it.todo('caller_message_id_survives_send (blocked: postMessage has no message id option in chat-adapter-baileys 2.1.0)');
});
