/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import type { Adapter } from 'chat';
import { Chat } from 'chat';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    ChamviError,
    Engine,
    InvalidAgentDefinitionError,
    InvalidRunStateError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { IClock, IEngine } from '@chamvi/core';
import {
    CHAT_STOP_TIMEOUT_ERROR_CODE,
    CHAT_STOP_TIMEOUT_MS,
    chatChannel,
    createChatIngressAdapter,
} from '@chamvi/chat';
import type { ChatChannelOptions, ChatIngress } from '@chamvi/chat';
import { ControllableClock, textModel } from '@chamvi/test-kit';
import { createChatChannel } from '../../../src/channel/module.ts';
import type { ChatIntake, ChatIntakeContext } from '../../../src/channel/types.ts';
import { bindIngress } from '../../../src/ingress/module.ts';
import { createFakeAdapter, createTextMessage } from '../../utils/adapter.ts';
import type { FakeAdapter } from '../../utils/adapter.ts';
import { createMemoryState, createRecordingLogger } from '../../utils/chat.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

function buildChat(adapters: Record<string, Adapter>): Chat {
    return new Chat({
        userName: 'chamvi',
        adapters,
        state: createMemoryState(),
        logger: createRecordingLogger(),
        concurrency: 'concurrent',
    });
}

/** lets queued promise work run (no timers) */
function flush(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

type Setup = {
    adapter: FakeAdapter;
    ingress: ChatIngress;
    chat: Chat;
    clock: ControllableClock;
    engine: Engine;
    channel: ReturnType<typeof createChatChannel>;
    errors: unknown[];
    accepted: Array<{ id: string; ctx: ChatIntakeContext }>;
};

function setup(input: {
    intake?: ChatIntake;
    patch?: Partial<ChatChannelOptions>;
} = {}): Setup {
    const clock = new ControllableClock(new Date('2026-11-01T09:00:00Z'));
    const adapter = createFakeAdapter();
    const ingress = createChatIngressAdapter(adapter);
    const chat = buildChat({ [ingress.name]: ingress });
    const errors: unknown[] = [];
    const accepted: Setup['accepted'] = [];
    const channel = createChatChannel({
        chat,
        adapters: [ingress],
        allowMessage: () => true,
        onError: (error) => {
            errors.push(error);
        },
        ...input.patch,
    }, input.intake ?? (async (incoming, ctx) => {
        accepted.push({ id: incoming.message.id, ctx });
    }));
    const engine = new Engine({
        store: createMemoryStore({ clock }),
        agents: [
            defineAgent({
                name: 'assistant',
                model: textModel(),
                instructions: 'Answer.',
                channels: [channel.on()],
            }),
        ],
        channels: [channel],
        clock,
        onError: (error) => {
            errors.push(error);
        },
    });

    engines.push(engine);

    return {
        adapter,
        ingress,
        chat,
        clock,
        engine,
        channel,
        errors,
        accepted,
    };
}

describe('chatChannel lifecycle', () => {
    it('factory_and_check_do_not_initialize', async () => {
        const { adapter, engine } = setup();
        const agent = engine.getAgent('assistant');

        expect(agent).toBeDefined();
        engine.checkAgent(agent!);
        expect(adapter.initializeCalls).toBe(0);
        expect(adapter.chat).toBeUndefined();

        await engine.start();

        expect(adapter.initializeCalls).toBe(1);
    });

    it('handlers_bound_before_connect', async () => {
        const order: string[] = [];
        let connected: { signal: AbortSignal; clock: IClock } | undefined;
        const fixture = setup({
            patch: {
                connect: async (ctx) => {
                    order.push('connect');
                    connected = ctx;
                },
            },
        });

        fixture.adapter.onInitialize = async () => {
            order.push('initialize');
            // a message during initialize already has its receiver
            await fixture.adapter.deliver(createTextMessage({ id: 'early' }));
        };

        await fixture.engine.start();

        expect(order).toEqual(['initialize', 'connect']);
        expect(fixture.accepted.map((item) => item.id)).toEqual(['early']);
        expect(connected?.clock).toBe(fixture.clock);
        expect(connected?.signal.aborted).toBe(false);
        expect(fixture.accepted[0]?.ctx.signal).toBe(connected?.signal);
        expect(fixture.accepted[0]?.ctx.context.engine).toBe(fixture.engine);
    });

    it('failed_connect_disconnects_and_shutdowns', async () => {
        const failure = new Error('socket refused');
        let disconnects = 0;
        let signal: AbortSignal | undefined;
        const fixture = setup({
            patch: {
                connect: async (ctx) => {
                    signal = ctx.signal;

                    throw failure;
                },
                disconnect: async () => {
                    disconnects += 1;
                },
            },
        });

        await expect(fixture.engine.start()).rejects.toBe(failure);

        expect(disconnects).toBe(1);
        // Chat.shutdown() disconnected the adapter
        expect(fixture.adapter.disconnectCalls).toBe(1);
        expect(signal?.aborted).toBe(true);

        // zero active callbacks: the adapter's messages find no receiver, a new one binds
        await expect(fixture.adapter.deliver(createTextMessage({ id: 'late' }))).rejects.toThrow(/no receiver/);
        expect(() => bindIngress(fixture.ingress, { receive: () => Promise.resolve() })()).not.toThrow();
        expect(fixture.accepted).toEqual([]);
    });

    it('stop_is_idempotent', async () => {
        let disconnects = 0;
        let signal: AbortSignal | undefined;
        const fixture = setup({
            patch: {
                connect: async (ctx) => {
                    signal = ctx.signal;
                },
                disconnect: async () => {
                    disconnects += 1;
                },
            },
        });

        // before any start: nothing to stop
        await fixture.channel.stop?.();
        await fixture.engine.start();

        await Promise.all([fixture.channel.stop?.(), fixture.channel.stop?.()]);
        await fixture.channel.stop?.();

        expect(signal?.aborted).toBe(true);
        expect(disconnects).toBe(1);
        expect(fixture.adapter.disconnectCalls).toBe(1);
        await expect(fixture.adapter.deliver(createTextMessage({ id: 'late' }))).rejects.toThrow(/no receiver/);

        // a later start is a new start with its own signal
        await fixture.channel.start?.(fixture.engine.channelContext(fixture.channel));

        expect(fixture.adapter.initializeCalls).toBe(2);
        expect(signal?.aborted).toBe(false);

        await fixture.adapter.deliver(createTextMessage({ id: 'again' }));

        expect(fixture.accepted.map((item) => item.id)).toEqual(['again']);
    });

    it('refuses a second start while started', async () => {
        const fixture = setup();

        await fixture.engine.start();

        await expect(fixture.channel.start?.(fixture.engine.channelContext(fixture.channel)))
            .rejects.toThrow(InvalidRunStateError);
    });

    it('stop_waits_for_accepted_intake', async () => {
        const release = Promise.withResolvers<void>();
        let intakeSignal: AbortSignal | undefined;
        const fixture = setup({
            intake: async (incoming, ctx) => {
                intakeSignal = ctx.signal;
                await release.promise;
                fixture.accepted.push({ id: incoming.message.id, ctx });
            },
        });

        await fixture.engine.start();

        fixture.adapter.deliverIgnored(createTextMessage({ id: 'slow' }));
        await flush();

        let stopped = false;
        const stop = fixture.engine.stop().then(() => {
            stopped = true;
        });

        await flush();

        // admission closed, the signal aborted, the Chat still up while the message is accepted
        expect(intakeSignal?.aborted).toBe(true);
        expect(stopped).toBe(false);
        expect(fixture.adapter.disconnectCalls).toBe(0);
        await expect(fixture.adapter.deliver(createTextMessage({ id: 'refused' }))).rejects.toThrow(/not accepting/);

        release.resolve();
        await stop;

        expect(fixture.accepted.map((item) => item.id)).toEqual(['slow']);
        expect(fixture.adapter.disconnectCalls).toBe(1);
        expect(fixture.errors).toHaveLength(1);
        expect(fixture.errors[0]).toBeInstanceOf(InvalidRunStateError);
    });

    it('reports a message still being accepted after the stop timeout and shuts down', async () => {
        const fixture = setup({
            intake: () => new Promise(() => {
                // never accepted
            }),
        });

        await fixture.engine.start();

        fixture.adapter.deliverIgnored(createTextMessage({ id: 'stuck' }));
        await flush();

        const stop = fixture.engine.stop();

        await flush();
        fixture.clock.advance(CHAT_STOP_TIMEOUT_MS - 1);
        await flush();
        expect(fixture.adapter.disconnectCalls).toBe(0);

        fixture.clock.advance(1);
        await stop;

        expect(fixture.adapter.disconnectCalls).toBe(1);
        expect(fixture.errors).toHaveLength(1);
        expect(fixture.errors[0]).toBeInstanceOf(ChamviError);
        expect((fixture.errors[0] as ChamviError).code).toBe(CHAT_STOP_TIMEOUT_ERROR_CODE);
        expect((fixture.errors[0] as Error).message).toMatch(/1 message\(s\)/);
    });

    it('reports a failed message once, also when its producer drops the promise', async () => {
        const failure = new Error('store down');
        const fixture = setup({
            intake: async () => {
                throw failure;
            },
        });

        await fixture.engine.start();

        fixture.adapter.deliverIgnored(createTextMessage({ id: 'dropped' }));
        await expect(fixture.adapter.deliver(createTextMessage({ id: 'awaited' }))).rejects.toBe(failure);
        await flush();

        expect(fixture.errors).toEqual([failure, failure]);
    });

    it('contains a throwing onError', async () => {
        const fixture = setup({
            intake: async () => {
                throw new Error('store down');
            },
            patch: {
                onError: () => {
                    throw new Error('onError broke');
                },
            },
        });

        await fixture.engine.start();

        fixture.adapter.deliverIgnored(createTextMessage({ id: 'dropped' }));
        await flush();
        await expect(fixture.adapter.deliver(createTextMessage({ id: 'awaited' }))).rejects.toThrow('store down');
    });

    it('accepts a message no agent subscribes to without starting a run', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const chat = buildChat({ [ingress.name]: ingress });
        const errors: unknown[] = [];
        const channel = chatChannel({
            chat,
            adapters: [ingress],
            allowMessage: () => true,
            onError: (error) => {
                errors.push(error);
            },
        });
        const engine = new Engine({
            store: createMemoryStore(),
            channels: [channel],
            agents: [],
        });

        engines.push(engine);
        await engine.start();

        await expect(adapter.deliver(createTextMessage({ id: 'm-1' }))).resolves.toBeUndefined();
        expect(await engine.store.runs.find({})).toEqual({ data: [], total: 0 });
        expect(errors).toEqual([]);
    });
});

describe('chatChannel options', () => {
    function options(patch: Partial<ChatChannelOptions> = {}): ChatChannelOptions {
        const ingress = createChatIngressAdapter(createFakeAdapter());

        return {
            chat: buildChat({ [ingress.name]: ingress }),
            adapters: [ingress],
            allowMessage: () => true,
            ...patch,
        };
    }

    it('duplicate_adapter_or_owner_refused', () => {
        const ingress = createChatIngressAdapter(createFakeAdapter());
        const chat = buildChat({ [ingress.name]: ingress });

        expect(() => chatChannel({
            chat,
            adapters: [ingress, ingress],
            allowMessage: () => true,
        }))
            .toThrow(/listed twice/);

        chatChannel({
            chat,
            adapters: [ingress],
            allowMessage: () => true,
        });

        // the Chat has its channel
        expect(() => chatChannel({
            chat,
            adapters: [ingress],
            allowMessage: () => true,
            name: 'chat-two',
        })).toThrow(/chat belongs to another chat channel/);

        // the ingress has its channel, also over another Chat
        expect(() => chatChannel({
            chat: buildChat({ [ingress.name]: ingress }),
            adapters: [ingress],
            allowMessage: () => true,
        })).toThrow(/adapter "fake" belongs to another chat channel/);
    });

    it('rejects_wrong_chat_adapter', () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);

        // the Chat holds the raw adapter, not the wrapper
        expect(() => chatChannel({
            chat: buildChat({ fake: adapter }),
            adapters: [ingress],
            allowMessage: () => true,
        })).toThrow(InvalidAgentDefinitionError);

        // the adapter is not wrapped at all
        expect(() => chatChannel({
            chat: buildChat({ fake: adapter }),
            adapters: [adapter as unknown as ChatIngress],
            allowMessage: () => true,
        })).toThrow(/createChatIngressAdapter/);

        // a refused factory claimed nothing: the wrapper still makes a channel
        expect(() => chatChannel({
            chat: buildChat({ fake: ingress }),
            adapters: [ingress],
            allowMessage: () => true,
        })).not.toThrow();
    });

    it('history_above_zero_refused', () => {
        expect(() => chatChannel(options({ history: 1 as 0 }))).toThrow(/history must be 0/);
        expect(() => chatChannel(options({ history: 0 }))).not.toThrow();
    });

    it('untrusted_by_default_and_option_validated', () => {
        expect(chatChannel(options()).untrusted).toBe(true);
        expect(chatChannel(options({ untrusted: true })).untrusted).toBe(true);
        expect(chatChannel(options({ untrusted: false })).untrusted).toBe(false);
        expect(() => chatChannel(options({ untrusted: 'no' as unknown as boolean }))).toThrow(/untrusted must be a boolean/);
        expect(() => chatChannel(options({ untrusted: null as unknown as boolean }))).toThrow(InvalidAgentDefinitionError);
    });

    it('validates the account alias', () => {
        expect(() => chatChannel(options({ account: 'ops-whatsapp' }))).not.toThrow();
        expect(() => chatChannel(options({ account: '' }))).toThrow(/account/);
        expect(() => chatChannel(options({ account: 'a\0b' }))).toThrow(/account/);
        expect(() => chatChannel(options({ account: 42 as unknown as string }))).toThrow(/account/);
    });

    it('validates the other options', () => {
        expect(() => chatChannel(options({ allowMessage: undefined as unknown as ChatChannelOptions['allowMessage'] })))
            .toThrow(/allowMessage/);
        expect(() => chatChannel(options({ name: 'Chat' }))).toThrow(/name/);
        expect(() => chatChannel(options({ timeoutMs: 0 }))).toThrow(/timeoutMs/);
        expect(() => chatChannel(options({ connect: 'x' as unknown as ChatChannelOptions['connect'] }))).toThrow(/connect/);
        expect(() => chatChannel(options({ defaultAddress: 'owner' }))).toThrow(/defaultAddress/);
        expect(() => chatChannel({ adapters: [], allowMessage: () => true } as unknown as ChatChannelOptions)).toThrow(/chat must be/);
        expect(() => chatChannel(options({ adapters: [] }))).toThrow(/adapters/);

        const named = chatChannel(options({ name: 'support' }));

        expect(named.name).toBe('support');
        expect(named.defaultAddress).toBeUndefined();

        const valid = options();
        const address = chatChannel(options()).to({ adapter: 'fake', threadId: 'fake:owner' });

        expect(chatChannel({ ...valid, defaultAddress: address }).defaultAddress).toBe(address);
    });
});
