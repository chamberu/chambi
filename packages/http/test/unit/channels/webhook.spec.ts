/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import {
    http,
    webhook,
    webhookChannel,
} from '@chamvi/http';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createTestApp,
    testAuth,
} from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

const ISSUES = '/channels/webhook/intake/issues';
const RAW = '/channels/webhook/raw/raw';

function setup() {
    const agents = [
        defineAgent({
            name: 'intake',
            model: textModel(),
            instructions: 'Intake.',
            channels: [
                http.on(),
                webhook.on('/issues', {
                    schema: z.object({ id: z.string() }),
                    idempotencyKey: (p) => `issue-${(p as { id: string }).id}`,
                    concurrencyKey: (p) => (p as { id: string }).id,
                }),
            ],
        }),
        defineAgent({
            name: 'raw',
            model: textModel(),
            instructions: 'Raw.',
            channels: [webhook.on('/raw'), webhook.on('/v1/deep/path'), webhook.on('/')],
        }),
    ];

    return createTestApp({ agents });
}

type Accepted = { runId: string; deduplicated: boolean };

describe('POST /channels/webhook/:agent/<path>', () => {
    it('classifies authenticated webhook payloads as untrusted', () => {
        expect(webhookChannel({ auth: [testAuth] }).untrusted).toBe(true);
    });

    it('dispatches through the webhook subscription without executing', async () => {
        const { app, store } = setup();
        const response = await call(app, 'POST', ISSUES, { token: ADMIN_TOKEN, body: { id: '7' } });

        expect(response.status).toBe(202);

        const { runId, deduplicated } = await response.json() as Accepted;

        expect(deduplicated).toBe(false);

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('queued');
        expect(run?.concurrencyKey).toBe('7');
        expect(run?.trigger.invoker).toBeUndefined();
        expect(run?.trigger).toMatchObject({
            channel: 'webhook',
            trigger: 'webhook:/issues',
            idempotencyKey: 'issue-7',
            concurrencyKey: '7',
            payload: { id: '7' },
        });
    });

    it('answers 400 when a key derived from the payload exceeds 255 characters', async () => {
        const { app, store } = setup();
        const response = await call(app, 'POST', ISSUES, { token: ADMIN_TOKEN, body: { id: 'x'.repeat(256) } });

        expect(response.status).toBe(400);
        expect((await store.runs.find({})).total).toBe(0);
    });

    it('dedupes a retried delivery by the subscription key', async () => {
        const { app, store } = setup();
        const first = await (await call(app, 'POST', ISSUES, { token: ADMIN_TOKEN, body: { id: '7' } })).json() as Accepted;
        const second = await (await call(app, 'POST', ISSUES, { token: ADMIN_TOKEN, body: { id: '7' } })).json() as Accepted;

        expect(second).toEqual({ runId: first.runId, deduplicated: true });
        expect((await store.runs.find({ agent: 'intake' })).total).toBe(1);
    });

    it('creates one run for parallel deliveries with one Idempotency-Key', async () => {
        const { app, store } = setup();
        const send = (id: string) => call(app, 'POST', ISSUES, {
            token: ADMIN_TOKEN,
            body: { id },
            headers: { 'idempotency-key': 'd-1' },
        });
        // different payload keys: the header wins over idempotencyKey(payload)
        const answers = await Promise.all([send('1'), send('2')]);
        const bodies = await Promise.all(answers.map((r) => r.json() as Promise<Accepted>));

        expect(answers.map((r) => r.status)).toEqual([202, 202]);
        expect(bodies.map((b) => b.deduplicated).sort()).toEqual([false, true]);
        expect(bodies[0]!.runId).toBe(bodies[1]!.runId);

        const { data, total } = await store.runs.find({ agent: 'intake' });

        expect(total).toBe(1);
        expect(data[0]?.trigger.idempotencyKey).toBe('d-1');
    });

    it('validates the payload with the subscription schema', async () => {
        const { app, store } = setup();
        const response = await call(app, 'POST', ISSUES, { token: ADMIN_TOKEN, body: { id: 7 } });

        expect(response.status).toBe(400);
        expect((await response.json()).issues[0].path).toEqual(['id']);
        expect((await store.runs.find({ agent: 'intake' })).total).toBe(0);
    });

    it('needs a JSON body', async () => {
        const { app } = setup();
        const empty = await call(app, 'POST', ISSUES, { token: ADMIN_TOKEN });

        expect(empty.status).toBe(400);
        expect((await empty.json()).message).toBe('The webhook needs a JSON body.');

        const text = await app.fetch(new Request(`http://test${ISSUES}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'text/plain' },
            body: 'hello',
        }));

        expect(text.status).toBe(415);
    });

    it('rejects an Idempotency-Key header out of bounds', async () => {
        const { app } = setup();
        const response = await call(app, 'POST', ISSUES, {
            token: ADMIN_TOKEN,
            body: { id: '1' },
            headers: { 'idempotency-key': 'x'.repeat(257) },
        });

        expect(response.status).toBe(400);
    });

    it.each([[[1, 2]], [null], ['text'], [5]])('takes any JSON payload without a schema: %j', async (body) => {
        const { app, store } = setup();
        const response = await call(app, 'POST', RAW, { token: ADMIN_TOKEN, body });

        expect(response.status).toBe(202);

        const { runId } = await response.json() as Accepted;

        expect((await store.runs.findOne(runId))?.trigger.payload).toEqual(body);
    });

    it('never reads the body of an unauthenticated request', async () => {
        const { app } = setup();
        const response = await call(app, 'POST', RAW, { body: { blob: 'x'.repeat(2 * 1024 * 1024) } });

        expect(response.status).toBe(401);
    });

    it.each([
        '/channels/webhook/intake/http',
        '/channels/webhook/intake/webhook:/issues',
        '/channels/webhook/intake/webhook%3A%2Fissues',
        '/channels/webhook/intake/issues/',
        '/channels/webhook/intake',
        '/channels/webhook/nope/x',
        '/channels/webhook',
        '/channels/webhook/',
        '/channels/webhook/intake/%E0%A4%A',
    ])('answers 404 for %s', async (path) => {
        const { app } = setup();
        const response = await call(app, 'POST', path, { token: ADMIN_TOKEN, body: { id: '1' } });

        expect(response.status).toBe(404);
    });

    it('names the path and agent in the 404', async () => {
        const { app } = setup();
        const response = await call(app, 'POST', '/channels/webhook/intake/http', { token: ADMIN_TOKEN, body: {} });

        expect((await response.json()).message).toBe('No webhook "/http" on agent "intake".');
    });

    it.each([
        ['/channels/webhook/raw/v1/deep/path', 'webhook:/v1/deep/path'],
        ['/channels/webhook/raw', 'webhook:/'],
        ['/channels/webhook/raw/', 'webhook:/'],
    ])('routes %s on the webhook path to %s', async (path, trigger) => {
        const { app, store } = setup();
        const response = await call(app, 'POST', path, { token: ADMIN_TOKEN, body: {} });

        expect(response.status).toBe(202);

        const { runId } = await response.json() as Accepted;

        expect((await store.runs.findOne(runId))?.trigger.trigger).toBe(trigger);
    });

    it('needs agent:<agent>:run', async () => {
        const { app } = setup();

        expect((await call(app, 'POST', ISSUES, { token: READER_TOKEN, body: { id: '1' } })).status).toBe(403);
        expect((await call(app, 'POST', ISSUES, { body: { id: '1' } })).status).toBe(401);
    });

    it('answers 404 while the http app does not mount the channel', async () => {
        const { app } = createTestApp({
            agents: [defineAgent({
                name: 'raw',
                model: textModel(),
                instructions: 'Raw.',
                channels: [webhook.on('/raw')],
            })],
            channels: [],
        });
        const response = await call(app, 'POST', RAW, { token: ADMIN_TOKEN, body: {} });

        expect(response.status).toBe(404);
    });
});

describe('webhookChannel()', () => {
    function limitedApp(bodyLimit: number) {
        const hooks = webhookChannel({
            name: 'hooks',
            auth: testAuth,
            bodyLimit,
        });

        return createTestApp({
            agents: [defineAgent({
                name: 'raw',
                model: textModel(),
                instructions: 'Raw.',
                channels: [hooks.on('/raw')],
            })],
            engineChannels: [hooks],
            channels: [hooks],
        });
    }

    it('serves a second instance under its own name, with on() bound to it', async () => {
        const { app, store } = limitedApp(1024);
        const response = await call(app, 'POST', '/channels/hooks/raw/raw', { token: ADMIN_TOKEN, body: { a: 1 } });

        expect(response.status).toBe(202);

        const { runId } = await response.json() as Accepted;

        expect((await store.runs.findOne(runId))?.trigger).toMatchObject({ channel: 'hooks', trigger: 'webhook:/raw' });
    });

    it('answers 413 above its bodyLimit', async () => {
        const { app, store } = limitedApp(16);
        const response = await call(app, 'POST', '/channels/hooks/raw/raw', { token: ADMIN_TOKEN, body: { blob: 'x'.repeat(64) } });

        expect(response.status).toBe(413);
        expect((await response.json()).code).toBe('request_entity_too_large');
        expect((await store.runs.find({})).total).toBe(0);
    });

    it('needs authenticators', () => {
        expect(() => webhookChannel({ auth: [] })).toThrow(InvalidAgentDefinitionError);
        expect(() => webhookChannel({} as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a bodyLimit that is no positive integer', () => {
        expect(() => webhookChannel({ auth: testAuth, bodyLimit: 0 })).toThrow(InvalidAgentDefinitionError);
        expect(() => webhookChannel({ auth: testAuth, bodyLimit: 1.5 })).toThrow(InvalidAgentDefinitionError);
    });
});

describe('webhook.on()', () => {
    it('builds the subscription of the default webhook channel', () => {
        const idempotencyKey = (p: unknown) => String(p);
        const subscription = webhook.on('/issues', { idempotencyKey });

        expect(subscription).toMatchObject({
            channel: 'webhook',
            id: 'webhook:/issues',
            options: { path: '/issues' },
        });
        expect(subscription.idempotencyKey).toBe(idempotencyKey);
        expect(subscription.concurrencyKey).toBeUndefined();
    });

    it.each(['', 'issues', 42])('refuses the path %j', (path) => {
        expect(() => webhook.on(path as string)).toThrow(InvalidAgentDefinitionError);
    });
});
