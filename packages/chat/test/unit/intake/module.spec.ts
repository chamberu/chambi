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
    ChamviError,
    ErrorCode,
    InvalidRunStateError,
    ValidationError,
    defineAgent,
} from '@chamvi/core';
import type { IEngine, Invoker } from '@chamvi/core';
import { CHAT_INTAKE_FAILED_ERROR_CODE } from '@chamvi/chat';
import type { ChatIncoming } from '@chamvi/chat';
import { textModel } from '@chamvi/test-kit';
import { createTextMessage } from '../../utils/adapter.ts';
import { createIntakeFixture, flush } from '../../utils/intake.ts';
import type { IntakeFixture, IntakeFixtureInput } from '../../utils/intake.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

async function started(input: Partial<IntakeFixtureInput> = {}): Promise<IntakeFixture> {
    const fixture = createIntakeFixture({
        agents: (channel) => [defineAgent({
            name: 'assistant',
            model: textModel(),
            instructions: 'Answer.',
            channels: [channel.on({ events: ['direct', 'mention'] })],
        })],
        ...input,
    });

    engines.push(fixture.engine);
    await fixture.engine.start();

    return fixture;
}

/** an attachment whose download is recorded */
function attachment(downloads: string[]) {
    return {
        type: 'image' as const,
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        fetchData: async () => {
            downloads.push('photo.jpg');

            return Buffer.from('bytes');
        },
    };
}

describe('chat intake policy', () => {
    it('denied_message_has_no_side_effects', async () => {
        const downloads: string[] = [];
        const policy: ChatIncoming[] = [];
        const resolveInvoker = vi.fn(() => undefined);
        const fixture = await started({
            patch: {
                allowMessage: (incoming) => {
                    policy.push(incoming);

                    return false;
                },
                resolveInvoker,
            },
        });
        const state = fixture.chat.getState() as unknown as { claimed: string[] };

        await expect(fixture.adapter.deliver(createTextMessage({
            id: 'denied',
            text: 'secret plan',
            attachments: [attachment(downloads)],
        }))).resolves.toBeUndefined();

        expect(policy).toHaveLength(1);
        expect(resolveInvoker).not.toHaveBeenCalled();
        expect(downloads).toEqual([]);
        expect(fixture.adapter.reads).toEqual([]);
        expect(fixture.adapter.posts).toEqual([]);
        expect(state.claimed).toEqual([]);
        expect(await fixture.runs()).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    it('unknown_identity_is_unprivileged', async () => {
        const permissions = ['agent:assistant:run'];
        const owner: Invoker = {
            id: 'owner',
            kind: 'chat',
            permissions,
        };
        const fixture = await started({ patch: { resolveInvoker: (incoming) => (incoming.message.author.userId === 'owner' ? owner : undefined) } });

        await fixture.adapter.deliver(createTextMessage({ id: 'm-owner', author: 'owner' }));
        await fixture.adapter.deliver(createTextMessage({ id: 'm-stranger', author: 'stranger' }));

        // a later change of the resolver's object never reaches the stored run
        permissions.push('*');

        const runs = await fixture.runs();
        const byAuthor = new Map(runs.map((run) => [(run.trigger.payload as { message: { author: { id: string } } }).message.author.id, run]));

        expect(byAuthor.get('owner')?.trigger.invoker).toEqual({
            id: 'owner',
            kind: 'chat',
            permissions: ['agent:assistant:run'],
        });
        expect(byAuthor.get('stranger')?.trigger).not.toHaveProperty('invoker');
    });

    it('raw_payload_not_stored', async () => {
        const fixture = await started();
        const message = createTextMessage({ id: 'm-raw', text: 'hi there' });

        message.raw = { providerSecret: 'raw-provider-object' };
        await fixture.adapter.deliver(message);

        const [run] = await fixture.runs();

        expect(run?.trigger.payload).toEqual({
            adapter: 'fake',
            event: 'direct',
            threadId: 'fake:chat-1',
            channelId: 'fake:chat-1',
            message: {
                id: 'm-raw',
                text: 'hi there',
                author: { id: 'user-1', name: 'User' },
                sentAt: new Date(0).toISOString(),
            },
        });
        expect(JSON.stringify(run)).not.toContain('raw-provider-object');
    });

    it('media_is_explicitly_refused', async () => {
        const downloads: string[] = [];
        const fixture = await started();

        const error = await fixture.adapter.deliver(createTextMessage({
            id: 'm-media',
            text: 'look at this',
            attachments: [attachment(downloads)],
        })).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toMatch(/attachments are not supported/);
        expect((error as Error).message).not.toContain('look at this');
        expect(downloads).toEqual([]);
        expect(await fixture.runs()).toEqual([]);
        expect(fixture.errors).toEqual([error]);
    });

    it('invalid_platform_id_refused', async () => {
        const allowMessage = vi.fn(() => true);
        const fixture = await started({ patch: { allowMessage } });
        const chat = fixture.adapter.chat!;

        for (const [threadId, id] of [
            ['fake:a\0b', 'm-1'],
            ['', 'm-2'],
            ['fake:chat-1', ''],
            ['fake:chat-1', 'x'.repeat(1025)],
        ]) {
            const message = createTextMessage({ id: id! });

            await expect(chat.processMessage(fixture.adapter, threadId!, message)).rejects.toThrow(ValidationError);
        }

        const stranger = createTextMessage({ id: 'm-3', author: '' });

        await expect(fixture.adapter.deliver(stranger)).rejects.toThrow(ValidationError);
        expect(allowMessage).not.toHaveBeenCalled();
        expect(await fixture.runs()).toEqual([]);
        expect(fixture.errors).toHaveLength(5);
        expect(JSON.stringify(fixture.errors.map((error) => (error as Error).message))).not.toContain('x'.repeat(100));
    });

    it('self_echo_skipped', async () => {
        const allowMessage = vi.fn(() => true);
        const fixture = await started({ patch: { allowMessage } });

        await expect(fixture.adapter.deliver(createTextMessage({ id: 'echo', isMe: true }))).resolves.toBeUndefined();

        expect(allowMessage).not.toHaveBeenCalled();
        expect(await fixture.runs()).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    it('classifies direct, mention and other group messages against the subscription events', async () => {
        const fixture = await started();

        fixture.adapter.isDirect = (threadId) => threadId.startsWith('fake:dm');

        await fixture.adapter.deliver(createTextMessage({ id: 'm-direct', thread: 'dm-1' }));
        await fixture.adapter.deliver(createTextMessage({
            id: 'm-mention',
            thread: 'group-1',
            isMention: true,
        }));
        await fixture.adapter.deliver(createTextMessage({ id: 'm-chatter', thread: 'group-1' }));

        const events = (await fixture.runs()).map((run) => (run.trigger.payload as { event: string }).event);

        expect(events.sort()).toEqual(['direct', 'mention']);
    });

    it('an adapter without isDM has no direct chats', async () => {
        const fixture = await started();

        Object.defineProperty(fixture.adapter, 'isDM', { value: undefined });
        await fixture.adapter.deliver(createTextMessage({ id: 'm-1', isMention: true }));
        await fixture.adapter.deliver(createTextMessage({ id: 'm-2' }));

        expect((await fixture.runs()).map((run) => (run.trigger.payload as { event: string }).event)).toEqual(['mention']);
    });
});

describe('chat intake delivery', () => {
    it('ignored_process_promise_has_no_unhandled_rejection', async () => {
        const unhandled: unknown[] = [];
        const listener = (reason: unknown) => {
            unhandled.push(reason);
        };

        process.on('unhandledRejection', listener);

        try {
            const fixture = await started();

            fixture.adapter.deliverIgnored(createTextMessage({ id: 'm-media', attachments: [attachment([])] }));
            await flush();
            await flush();

            expect(fixture.errors).toHaveLength(1);
            expect(fixture.errors[0]).toBeInstanceOf(ValidationError);
        } finally {
            process.off('unhandledRejection', listener);
        }

        expect(unhandled).toEqual([]);
    });

    it('concurrent deliveries of one message share one intake and one report', async () => {
        const allowMessage = vi.fn(async () => {
            await flush();

            return true;
        });
        const fixture = await started({ patch: { allowMessage } });
        const message = createTextMessage({ id: 'm-twice', attachments: [attachment([])] });

        const first = fixture.adapter.deliver(message);
        const second = fixture.adapter.deliver(message);

        await expect(first).rejects.toThrow(ValidationError);
        await expect(second).rejects.toThrow(ValidationError);
        expect(allowMessage).toHaveBeenCalledTimes(1);
        expect(fixture.errors).toHaveLength(1);

        // nothing remembered once it settled: the message may come again
        await expect(fixture.adapter.deliver(message)).rejects.toThrow(ValidationError);
        expect(allowMessage).toHaveBeenCalledTimes(2);
    });

    it('routes the deprecated handleIncomingMessage into the intake, not the SDK', async () => {
        const fixture = await started();
        const state = fixture.chat.getState() as unknown as { claimed: string[] };
        const message = createTextMessage({ id: 'm-legacy' });

        await fixture.adapter.chat!.handleIncomingMessage(fixture.adapter, message.threadId, message);

        expect(await fixture.runs()).toHaveLength(1);
        expect(state.claimed).toEqual([]);
    });

    it('reports a message refused after stop once, without its text', async () => {
        const fixture = await started();

        await fixture.engine.stop();
        fixture.adapter.deliverIgnored(createTextMessage({ id: 'late', text: 'late secret' }));
        await flush();

        expect(fixture.errors).toHaveLength(1);
        expect(fixture.errors[0]).toBeInstanceOf(InvalidRunStateError);
        expect((fixture.errors[0] as Error).message).toMatch(/not started/);
        expect((fixture.errors[0] as Error).message).not.toContain('late secret');
        expect(await fixture.runs()).toEqual([]);
    });

    it('retries a transient dispatch failure after 1000 and 2000 ms, then reports it once', async () => {
        let inserts = 0;
        const fixture = await started({
            store: (memory) => ({
                ...memory,
                runs: new Proxy(memory.runs, {
                    get(target, key, receiver) {
                        if (key === 'insert') {
                            return async () => {
                                inserts += 1;

                                throw new Error('store down');
                            };
                        }

                        const value: unknown = Reflect.get(target, key, receiver);

                        return typeof value === 'function' ? value.bind(target) : value;
                    },
                }),
            }),
        });

        const delivery = fixture.adapter.deliver(createTextMessage({ id: 'm-retry', text: 'private words' })).catch((caught: unknown) => caught);

        await vi.waitFor(() => expect(inserts).toBe(1));
        fixture.clock.advance(999);
        await flush();
        expect(inserts).toBe(1);
        fixture.clock.advance(1);
        await vi.waitFor(() => expect(inserts).toBe(2));
        fixture.clock.advance(1999);
        await flush();
        expect(inserts).toBe(2);
        fixture.clock.advance(1);

        const error = await delivery;

        expect(inserts).toBe(3);
        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe(CHAT_INTAKE_FAILED_ERROR_CODE);
        expect((error as Error).message).toMatch(/assistant/);
        expect((error as Error).message).toMatch(/3 attempt/);
        expect((error as Error).message).not.toContain('private words');
        expect(fixture.errors).toEqual([error]);

        // no further attempt
        fixture.clock.advance(10_000);
        await flush();
        expect(inserts).toBe(3);
    });

    it('stops retrying when the channel stops', async () => {
        let inserts = 0;
        const fixture = await started({
            store: (memory) => ({
                ...memory,
                runs: new Proxy(memory.runs, {
                    get(target, key, receiver) {
                        if (key === 'insert') {
                            return async () => {
                                inserts += 1;

                                throw new Error('store down');
                            };
                        }

                        const value: unknown = Reflect.get(target, key, receiver);

                        return typeof value === 'function' ? value.bind(target) : value;
                    },
                }),
            }),
        });

        const delivery = fixture.adapter.deliver(createTextMessage({ id: 'm-stop' })).catch((caught: unknown) => caught);

        await vi.waitFor(() => expect(inserts).toBe(1));
        await fixture.engine.stop();

        expect(await delivery).toBeInstanceOf(InvalidRunStateError);
        fixture.clock.advance(10_000);
        await flush();
        expect(inserts).toBe(1);
        expect(fixture.errors).toHaveLength(1);
    });

    it('treats a throwing filter as a terminal failure of its agent only', async () => {
        const fixture = await started({
            agents: (channel) => [
                defineAgent({
                    name: 'broken',
                    model: textModel(),
                    instructions: 'Answer.',
                    channels: [channel.on({
                        filter: () => {
                            throw new ValidationError('bad filter');
                        },
                    })],
                }),
                defineAgent({
                    name: 'working',
                    model: textModel(),
                    instructions: 'Answer.',
                    channels: [channel.on()],
                }),
            ],
        });

        const error = await fixture.adapter.deliver(createTextMessage({ id: 'm-1' })).catch((caught: unknown) => caught);

        expect((error as ChamviError).code).toBe(CHAT_INTAKE_FAILED_ERROR_CODE);
        expect((error as Error).message).toMatch(/broken/);
        expect(((error as Error).cause as ChamviError).code).toBe(ErrorCode.VALIDATION);
        expect((await fixture.runs()).map((run) => run.agent)).toEqual(['working']);
    });
});
