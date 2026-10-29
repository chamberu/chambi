/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import { defineAgent } from '@chamvi/core';
import { http, staticTokens } from '@chamvi/http';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunAgents,
    createRunTestApp,
} from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

describe('POST /agents/:name/runs', () => {
    it('dispatches through the http channel', async () => {
        const { app, stores: store } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { payload: { n: 1 } } });
        expect(response.status).toBe(202);
        const body = await response.json() as { runId: string; deduplicated: boolean };
        expect(body).toEqual({ runId: expect.any(String), deduplicated: false });

        const run = await store.runs.getRun(body.runId);
        expect(run?.trigger).toMatchObject({
            channel: 'http',
            trigger: 'http',
            payload: { n: 1 },
        });
    });

    it('accepts an empty body', async () => {
        const { app, stores: store } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN });
        expect(response.status).toBe(202);
        const { runId } = await response.json() as { runId: string };
        expect((await store.runs.getRun(runId))?.trigger.payload).toBeUndefined();
    });

    it('dedupes by idempotencyKey in the body', async () => {
        const { app } = createRunTestApp();
        const first = await (await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { idempotencyKey: 'k1' } })).json();
        const second = await (await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { idempotencyKey: 'k1' } })).json();
        expect(second).toEqual({ runId: first.runId, deduplicated: true });
    });

    it('scopes an idempotency key to the principal', async () => {
        const low = 'low-runner-token-0123456789';
        const high = 'high-runner-token-0123456789';
        const { app, stores: store } = createRunTestApp({
            auth: [staticTokens({
                tokens: [
                    {
                        value: low,
                        id: 'u-low',
                        permissions: ['agent:echo:run'],
                    },
                    {
                        value: high,
                        id: 'u-high',
                        permissions: ['agent:echo:run', 'tool:echo:*'],
                    },
                ],
            })],
        });
        const start = async (token: string) => (await call(app, 'POST', '/agents/echo/runs', { token, body: { idempotencyKey: 'issue-42' } })).json();
        const first = await start(low);
        const second = await start(high);
        expect(second.deduplicated).toBe(false);
        expect(second.runId).not.toBe(first.runId);
        expect((await store.runs.getRun(second.runId))?.trigger.invoker?.id).toBe('u-high');
        expect(await start(high)).toEqual({ runId: second.runId, deduplicated: true });
    });

    it('dedupes by the Idempotency-Key header', async () => {
        const { app } = createRunTestApp();
        const headers = { 'idempotency-key': 'h1' };
        const first = await (await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, headers })).json();
        const second = await (await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, headers })).json();
        expect(second).toEqual({ runId: first.runId, deduplicated: true });
    });

    it('rejects an Idempotency-Key header out of bounds', async () => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, headers: { 'idempotency-key': 'x'.repeat(256) } });
        expect(response.status).toBe(400);
    });

    it('bounds address and idempotencyKey at 255 characters, the store column width', async () => {
        const { app } = createRunTestApp();
        for (const key of ['address', 'idempotencyKey']) {
            const fits = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { [key]: 'x'.repeat(255) } });
            expect(fits.status).toBe(202);
            const over = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { [key]: 'y'.repeat(256) } });
            expect(over.status).toBe(400);
        }
    });

    it('answers 404 for an unknown agent', async () => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/nope/runs', { token: ADMIN_TOKEN });
        expect(response.status).toBe(404);
        expect((await response.json()).message).toBe('Agent "nope" was not found.');
    });

    it.each(['sweep', 'hooked'])('answers 404 for %s, which has no http subscription', async (name) => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', `/agents/${name}/runs`, { token: ADMIN_TOKEN });
        expect(response.status).toBe(404);
        expect((await response.json()).message).toBe(`Agent "${name}" has no http subscription.`);
    });

    it('needs agent:<name>:run', async () => {
        const { app } = createRunTestApp();
        expect((await call(app, 'POST', '/agents/echo/runs', { token: READER_TOKEN })).status).toBe(403);
        expect((await call(app, 'POST', '/agents/echo/runs')).status).toBe(401);
    });

    it('never reads the body of an unauthenticated request', async () => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { body: { payload: 'x'.repeat(2 * 1024 * 1024) } });
        expect(response.status).toBe(401);
    });

    it.each([[[1]], ['str'], [null]])('rejects the body %j', async (body) => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body });
        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('The request body must be a JSON object.');
    });

    it('rejects an empty idempotencyKey', async () => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { idempotencyKey: '' } });
        expect(response.status).toBe(400);
        expect((await response.json()).issues[0].path).toEqual(['idempotencyKey']);
    });

    it('drops unknown body keys', async () => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { extra: 1 } });
        expect(response.status).toBe(202);
    });

    it('validates the payload with the subscription schema', async () => {
        const typed = defineAgent({
            name: 'typed',
            model: textModel(),
            instructions: 'Typed.',
            channels: [http.on({ schema: z.object({ n: z.number() }) })],
        });
        const { app, stores: store } = createRunTestApp({ agents: [...createRunAgents(), typed] });
        const response = await call(app, 'POST', '/agents/typed/runs', { token: ADMIN_TOKEN, body: { payload: { n: 'x' } } });
        expect(response.status).toBe(400);
        expect((await response.json()).issues[0].path).toEqual(['n']);
        expect((await store.runs.listRuns({ agent: 'typed' })).total).toBe(0);
    });

    describe('attachments', () => {
        function b64(text: string): string {
            return Buffer.from(text).toString('base64');
        }

        it('stores each attachment as an artifact of the run', async () => {
            const { app, stores: store } = createRunTestApp();
            const response = await call(app, 'POST', '/agents/echo/runs', {
                token: ADMIN_TOKEN,
                body: {
                    attachments: [
                        {
                            mediaType: 'text/plain',
                            filename: 'a.txt',
                            data: b64('alpha'),
                            extra: 1,
                        },
                        { mediaType: 'image/png', data: b64('beta') },
                    ],
                },
            });
            expect(response.status).toBe(202);
            const { runId } = await response.json() as { runId: string };

            const run = await store.runs.getRun(runId);
            expect(run?.trigger.attachments).toHaveLength(2);
            const [first, second] = run!.trigger.attachments!;
            expect(first).toMatchObject({
                runId,
                agent: 'echo',
                mediaType: 'text/plain',
                filename: 'a.txt',
                size: 5,
            });
            expect(second).not.toHaveProperty('filename');
            expect(new TextDecoder().decode(await store.artifacts.readArtifact(first!.id))).toBe('alpha');
            expect(new TextDecoder().decode(await store.artifacts.readArtifact(second!.id))).toBe('beta');
            expect(await store.artifacts.listArtifacts(runId)).toHaveLength(2);
        });

        it('takes an empty list as none', async () => {
            const { app, stores: store } = createRunTestApp();
            const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { attachments: [] } });
            expect(response.status).toBe(202);
            const { runId } = await response.json() as { runId: string };
            expect((await store.runs.getRun(runId))?.trigger.attachments).toBeUndefined();
        });

        it('accepts at most 16 attachments', async () => {
            const { app } = createRunTestApp();
            const one = { mediaType: 'text/plain', data: b64('x') };
            const fits = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { attachments: Array.from({ length: 16 }, () => one) } });
            expect(fits.status).toBe(202);
            const over = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { attachments: Array.from({ length: 17 }, () => one) } });
            expect(over.status).toBe(400);
            expect((await over.json()).issues[0].path).toEqual(['attachments']);
        });

        it.each([
            ['bad base64', { mediaType: 'text/plain', data: 'aGk' }, ['attachments', 0, 'data']],
            ['url-safe base64', { mediaType: 'text/plain', data: '-_8=' }, ['attachments', 0, 'data']],
            ['a missing data', { mediaType: 'text/plain' }, ['attachments', 0, 'data']],
            ['a bad mediaType', { mediaType: 'png', data: 'aGk=' }, ['attachments', 0, 'mediaType']],
            ['a mediaType with parameters', { mediaType: 'text/plain; charset=utf-8', data: 'aGk=' }, ['attachments', 0, 'mediaType']],
            ['an empty filename', {
                mediaType: 'text/plain',
                filename: '',
                data: 'aGk=',
            }, ['attachments', 0, 'filename']],
        ])('rejects %s with 400 and stores nothing', async (_, attachment, path) => {
            const { app, stores: store } = createRunTestApp();
            const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { attachments: [attachment] } });
            expect(response.status).toBe(400);
            const body = await response.json();
            expect(body.code).toBe('validation_error');
            expect(body.issues.map((i: { path: unknown }) => i.path)).toContainEqual(path);
            expect((await store.runs.listRuns({ agent: 'echo' })).total).toBe(0);
        });

        it.each([['str'], [{ 0: 1 }], [null], [[1]]])('rejects attachments %j', async (attachments) => {
            const { app } = createRunTestApp();
            const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { attachments } });
            expect(response.status).toBe(400);
        });

        it.each([
            ['an oversized list', Array.from({ length: 20000 }, () => ({}))],
            ['an object with many keys', Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, {}]))],
        ])('answers %s with one issue before checking any item', async (_, attachments) => {
            const { app } = createRunTestApp({ bodyLimit: 1024 * 1024 });
            const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { attachments } });
            expect(response.status).toBe(400);
            const body = await response.json();
            expect(body.issues).toHaveLength(1);
            expect(body.issues[0].path).toEqual(['attachments']);
        });

        it.each([
            ['an oversized list of large attachments', { attachments: Array.from({ length: 17 }, () => ({ mediaType: 'text/plain', data: b64('x'.repeat(45_000)) })) }, ['attachments']],
            ['a long string as attachments', { attachments: 'A'.repeat(100_000) }, ['attachments']],
            ['a long mediaType', { attachments: [{ mediaType: 'x'.repeat(100_000), data: 'aGk=' }] }, ['attachments', 0, 'mediaType']],
            ['a long address', { address: 'x'.repeat(500_000) }, ['address']],
        ])('answers %s with a small 400 body', async (_, body, path) => {
            const { app } = createRunTestApp({ bodyLimit: 4 * 1024 * 1024 });
            const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body });
            expect(response.status).toBe(400);
            const text = await response.text();
            expect(text.length).toBeLessThan(2048);
            expect(JSON.parse(text).issues.map((i: { path: unknown }) => i.path)).toContainEqual(path);
        });

        it('stores nothing for a deduplicated dispatch', async () => {
            const { app, stores: store } = createRunTestApp();
            const body = { idempotencyKey: 'k', attachments: [{ mediaType: 'text/plain', data: b64('x') }] };
            const first = await (await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body })).json();
            const second = await (await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body })).json();
            expect(second).toEqual({ runId: first.runId, deduplicated: true });
            expect(await store.artifacts.listArtifacts(first.runId)).toHaveLength(1);
        });

        it('stays bounded by bodyLimit', async () => {
            const { app } = createRunTestApp({ bodyLimit: 1024 });
            const response = await call(app, 'POST', '/agents/echo/runs', {
                token: ADMIN_TOKEN,
                body: { attachments: [{ mediaType: 'text/plain', data: b64('x'.repeat(2048)) }] },
            });
            expect(response.status).toBe(413);
        });
    });

    it('answers 404 when the agent is removed while the request was in flight', async () => {
        const errors: unknown[] = [];
        const { app, engine } = createRunTestApp({ onError: (error) => { errors.push(error); } });
        const dispatch = engine.dispatch.bind(engine);
        vi.spyOn(engine, 'dispatch').mockImplementationOnce(async (envelope) => {
            await engine.removeAgent('echo');
            return dispatch(envelope);
        });
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'agent_not_found' });
        expect(errors).toEqual([]);
    });
});
