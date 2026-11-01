/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { createHmac } from 'node:crypto';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    InvalidAgentDefinitionError,
    defineAgent,
} from '@chamvi/core';
import type { ChamviError, IEngine } from '@chamvi/core';
import { createHttpApp, staticTokens } from '@chamvi/http';
import { CHAT_BODY_LIMIT_BYTES, CHAT_INTAKE_FAILED_ERROR_CODE, CHAT_WEBHOOK_TIMEOUT_MS } from '@chamvi/chat';
import type { ChatChannel } from '@chamvi/chat';
import { textModel } from '@chamvi/test-kit';
import { createTextMessage } from '../../utils/adapter.ts';
import type { FakeAdapter } from '../../utils/adapter.ts';
import { createIntakeFixture, flush } from '../../utils/intake.ts';
import type { IntakeFixture, IntakeFixtureInput } from '../../utils/intake.ts';

const SECRET = 'webhook-secret';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

type HttpFixture = IntakeFixture & {
    app: ReturnType<typeof createHttpApp>;
    post(path: string, body: string | Uint8Array<ArrayBuffer>, headers?: Record<string, string>): Promise<Response>;
};

function agentOf(channel: ChatChannel) {
    return defineAgent({
        name: 'assistant',
        model: textModel(),
        instructions: 'Answer.',
        channels: [channel.on()],
    });
}

async function serve(input: Partial<IntakeFixtureInput> & { start?: boolean } = {}): Promise<HttpFixture> {
    const fixture = createIntakeFixture({
        agents: (channel) => [agentOf(channel)],
        adapterNames: ['fake', 'other'],
        ...input,
        patch: { webhooks: ['fake'], ...input.patch },
    });

    engines.push(fixture.engine);

    if (input.start !== false) {
        await fixture.engine.start();
    }

    const app = createHttpApp({
        engine: fixture.engine,
        auth: [staticTokens({
            tokens: [{
                value: 'admin-token-0123456789',
                id: 'admin',
                permissions: ['*'],
            }],
        })],
        metrics: false,
        rateLimit: false,
        channels: [fixture.channel],
    });

    return {
        ...fixture,
        app,
        post: (path, body, headers = {}) => app.fetch(new Request(`http://test${path}`, {
            method: 'POST',
            headers,
            body,
        })),
    };
}

/** a webhook adapter that hands one text message to the chat, as a Chat SDK adapter's handleWebhook does */
function forwardMessage(
    adapter: FakeAdapter,
    id: string,
    options: { waitUntil?: boolean; message?: Partial<Parameters<typeof createTextMessage>[0]> } = {},
) {
    adapter.onWebhook = async (_request, webhookOptions) => {
        const message = createTextMessage({
            id,
            text: 'private words',
            ...options.message,
        });

        if (options.waitUntil === false) {
            // an adapter that drops both the promise and the options
            void adapter.chat!.processMessage(adapter, message.threadId, message).catch(() => undefined);
        } else {
            void adapter.chat!.processMessage(adapter, message.threadId, message, webhookOptions).catch(() => undefined);
        }

        return new Response('ok', { status: 200 });
    };
}

function failingInserts(counter: { inserts: number }): IntakeFixtureInput['store'] {
    return (memory) => ({
        ...memory,
        runs: new Proxy(memory.runs, {
            get(target, key, receiver) {
                if (key === 'insert') {
                    return async () => {
                        counter.inserts += 1;

                        throw new Error('store down');
                    };
                }

                const value: unknown = Reflect.get(target, key, receiver);

                return typeof value === 'function' ? value.bind(target) : value;
            },
        }),
    });
}

describe('chat channel webhooks', () => {
    it('only_declared_adapter_subpath', async () => {
        const fixture = await serve();
        const [fake, other] = fixture.adapters as [FakeAdapter, FakeAdapter];
        const reached: string[] = [];

        fake.onWebhook = async () => {
            reached.push('fake');

            return new Response('fake', { status: 200 });
        };
        other.onWebhook = async () => {
            reached.push('other');

            return new Response('other', { status: 200 });
        };

        const ok = await fixture.post('/channels/chat/fake', '{}', { 'content-type': 'application/json' });

        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe('fake');

        for (const path of [
            '/channels/chat/other',
            '/channels/chat',
            '/channels/chat/',
            '/channels/chat/fake/more',
            '/channels/chat/unknown',
            '/channels/chat/%ZZ',
            '/channels/nope/fake',
        ]) {
            const response = await fixture.post(path, '{}');

            expect(response.status, path).toBe(404);
        }

        const get = await fixture.app.fetch(new Request('http://test/channels/chat/fake'));

        expect(get.status).toBe(404);
        expect(reached).toEqual(['fake']);
    });

    it('has no in without declared webhooks, and refuses webhooks of no adapter', () => {
        const plain = createIntakeFixture({ agents: () => [] });

        expect(plain.channel.in).toBeUndefined();
        expect(() => createHttpApp({
            engine: plain.engine,
            auth: [staticTokens({
                tokens: [{
                    value: 'admin-token-0123456789',
                    id: 'a',
                    permissions: ['*'],
                }],
            })],
            metrics: false,
            channels: [plain.channel],
        })).toThrow(InvalidAgentDefinitionError);

        for (const webhooks of [['missing'], ['fake', 'fake'], 'fake', [''], [1]]) {
            expect(() => createIntakeFixture({
                agents: () => [],
                patch: { webhooks: webhooks as never },
            }), JSON.stringify(webhooks)).toThrow(InvalidAgentDefinitionError);
        }
    });

    it('raw_form_body_survives_bounded_read', async () => {
        const fixture = await serve();
        const body = 'a=1&b=%C3%A9+x&c=&d=%26%3D';
        let seen: {
            bytes: Uint8Array;
            type: string | null;
            method: string;
            url: string
        } | undefined;

        fixture.adapter.onWebhook = async (request) => {
            seen = {
                bytes: new Uint8Array(await request.arrayBuffer()),
                type: request.headers.get('content-type'),
                method: request.method,
                url: request.url,
            };

            return new Response(null, { status: 204 });
        };

        const response = await fixture.post('/channels/chat/fake?x=1', body, { 'content-type': 'application/x-www-form-urlencoded' });

        expect(response.status).toBe(204);
        expect(seen?.bytes).toEqual(new Uint8Array(Buffer.from(body, 'utf8')));
        expect(seen?.type).toBe('application/x-www-form-urlencoded');
        expect(seen?.method).toBe('POST');
        expect(seen?.url).toBe('http://test/channels/chat/fake?x=1');
    });

    it('oversize_before_adapter', async () => {
        const fixture = await serve();
        const sizes: number[] = [];

        fixture.adapter.onWebhook = async (request) => {
            sizes.push((await request.arrayBuffer()).byteLength);

            return new Response(null, { status: 200 });
        };

        const over = await fixture.post('/channels/chat/fake', new Uint8Array(CHAT_BODY_LIMIT_BYTES + 1));

        expect(over.status).toBe(413);
        expect(sizes).toEqual([]);

        const exact = await fixture.post('/channels/chat/fake', new Uint8Array(CHAT_BODY_LIMIT_BYTES));

        expect(exact.status).toBe(200);
        expect(sizes).toEqual([CHAT_BODY_LIMIT_BYTES]);
    });

    it('signed_request_not_json_reencoded', async () => {
        const fixture = await serve();
        // whitespace, key order and escapes a JSON parse and stringify would change
        const body = '{ "b" : 1,\n  "a":"\\u00e9\\/" ,"z": 1.50 }';
        const signature = createHmac('sha256', SECRET).update(body).digest('hex');
        let verified: boolean | undefined;

        fixture.adapter.onWebhook = async (request, options) => {
            const bytes = Buffer.from(await request.arrayBuffer());

            verified = createHmac('sha256', SECRET).update(bytes).digest('hex') === request.headers.get('x-signature');

            if (!verified) {
                return new Response('bad signature', { status: 401 });
            }

            const message = createTextMessage({ id: 'm-signed' });

            void fixture.adapter.chat!.processMessage(fixture.adapter, message.threadId, message, options).catch(() => undefined);

            return new Response('ok', { status: 200 });
        };

        const response = await fixture.post('/channels/chat/fake', body, {
            'content-type': 'application/json',
            'x-signature': signature,
        });

        expect(verified).toBe(true);
        expect(response.status).toBe(200);
        // answered only once the run is stored
        expect(await fixture.runs()).toHaveLength(1);
        expect(fixture.errors).toEqual([]);
    });

    it('dispatch_failure_is_503', async () => {
        const counter = { inserts: 0 };
        const fixture = await serve({ store: failingInserts(counter) });

        forwardMessage(fixture.adapter, 'm-fail');

        let answered: Response | undefined;
        const pending = fixture.post('/channels/chat/fake', '{}').then((response) => {
            answered = response;

            return response;
        });

        await vi.waitFor(() => expect(counter.inserts).toBe(1));
        await flush();
        // still waiting for acceptance: no 2xx while the retries run
        expect(answered).toBeUndefined();
        fixture.clock.advance(1000);
        await vi.waitFor(() => expect(counter.inserts).toBe(2));
        fixture.clock.advance(2000);

        const response = await pending;

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ status: 503, code: 'service_unavailable' });
        expect(counter.inserts).toBe(3);
        // reported once, by the intake, without the message text
        expect(fixture.errors).toHaveLength(1);
        expect((fixture.errors[0] as ChamviError).code).toBe(CHAT_INTAKE_FAILED_ERROR_CODE);
        expect(JSON.stringify(fixture.errors.map((error) => (error as Error).message))).not.toContain('private words');
    });

    it('answers the adapter\'s 2xx for a refused media message and reports it once', async () => {
        const fixture = await serve();

        forwardMessage(fixture.adapter, 'm-media', {
            message: {
                attachments: [{
                    type: 'image',
                    mimeType: 'image/png',
                    name: 'a.png',
                }],
            },
        });

        const response = await fixture.post('/channels/chat/fake', '{}');

        // a retry cannot change a refusal: the platform must not redeliver it forever
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok');
        expect(fixture.errors).toHaveLength(1);
        expect((fixture.errors[0] as ChamviError).code).toBe('validation_error');
        expect(await fixture.runs()).toEqual([]);
    });

    it('answers the adapter\'s 2xx when every agent refused the message terminally', async () => {
        const fixture = await serve({
            agents: (channel) => [defineAgent({
                name: 'assistant',
                model: textModel(),
                instructions: 'Answer.',
                channels: [channel.on({
                    filter: () => {
                        throw new Error('filter broke');
                    },
                })],
            })],
        });

        forwardMessage(fixture.adapter, 'm-filter');

        const response = await fixture.post('/channels/chat/fake', '{}');

        expect(response.status).toBe(200);
        expect(fixture.errors).toHaveLength(1);
        expect((fixture.errors[0] as ChamviError).code).toBe(CHAT_INTAKE_FAILED_ERROR_CODE);
    });

    it('answers 503 when the adapter drops the message promise and its options', async () => {
        const counter = { inserts: 0 };
        const fixture = await serve({ store: failingInserts(counter) });

        forwardMessage(fixture.adapter, 'm-dropped', { waitUntil: false });

        const pending = fixture.post('/channels/chat/fake', '{}');

        await vi.waitFor(() => expect(counter.inserts).toBe(1));
        fixture.clock.advance(1000);
        await vi.waitFor(() => expect(counter.inserts).toBe(2));
        fixture.clock.advance(2000);

        expect((await pending).status).toBe(503);
        expect(fixture.errors).toHaveLength(1);
    });

    it('answers 503 for a message while the channel is not started', async () => {
        const fixture = await serve({ start: false });

        // the Chat initializes the adapter on start only; do it here so the adapter has a chat
        await fixture.chat.initialize();
        forwardMessage(fixture.adapter, 'm-stopped');

        const response = await fixture.post('/channels/chat/fake', '{}');

        expect(response.status).toBe(503);
        expect(await fixture.runs()).toEqual([]);
    });

    it('answers 503 and reports when acceptance outlasts the webhook timeout', async () => {
        const fixture = await serve();

        let called = false;

        fixture.adapter.onWebhook = async (_request, options) => {
            called = true;
            options?.waitUntil?.(new Promise(() => {}));

            return new Response('ok', { status: 200 });
        };

        let answered: Response | undefined;
        const pending = fixture.post('/channels/chat/fake', '{}').then((response) => {
            answered = response;

            return response;
        });

        await vi.waitFor(() => expect(called).toBe(true));
        await flush();
        fixture.clock.advance(CHAT_WEBHOOK_TIMEOUT_MS - 1);
        await flush();
        expect(answered).toBeUndefined();
        fixture.clock.advance(1);

        expect((await pending).status).toBe(503);
        expect(fixture.errors).toHaveLength(1);
        expect((fixture.errors[0] as Error).message).toMatch(/30000ms/);
    });

    it('reports a failing background task of the adapter once', async () => {
        const fixture = await serve();

        fixture.adapter.onWebhook = async (_request, options) => {
            options?.waitUntil?.(Promise.reject(new Error('adapter background failed')));

            return new Response('ok', { status: 200 });
        };

        const response = await fixture.post('/channels/chat/fake', '{}');

        expect(response.status).toBe(503);
        expect(fixture.errors).toHaveLength(1);
        expect((fixture.errors[0] as Error).message).toBe('adapter background failed');
    });

    it('native_verification_failure_preserved', async () => {
        const fixture = await serve();

        fixture.adapter.onWebhook = async () => new Response('bad signature', {
            status: 401,
            headers: { 'www-authenticate': 'Signature', 'content-type': 'text/plain' },
        });

        const response = await fixture.post('/channels/chat/fake', '{}');

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Signature');
        expect(await response.text()).toBe('bad signature');
        expect(await fixture.runs()).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    it('starts no run and answers no approval for an SDK action', async () => {
        const fixture = await serve();

        fixture.adapter.onWebhook = async (_request, options) => {
            await fixture.adapter.chat!.processAction({
                adapter: fixture.adapter,
                actionId: 'approve',
                messageId: 'm-card',
                threadId: 'fake:chat-1',
                raw: {},
                value: 'approved',
                user: {
                    userId: 'user-1',
                    userName: 'user',
                    fullName: 'User',
                    isBot: false,
                    isMe: false,
                },
            }, options);

            return new Response('ok', { status: 200 });
        };

        const response = await fixture.post('/channels/chat/fake', '{}');

        expect(response.status).toBe(200);
        expect(await fixture.runs()).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });
});
