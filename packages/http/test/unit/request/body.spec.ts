/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { BadRequestError } from '@ebec/http';
import { App, defineCoreHandler } from 'routup';
import { Container } from 'validup';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildContext, createErrorHandler } from '../../../src/app/helpers.ts';
import { readJsonBody, validateBody, validatePayload } from '../../../src/request/helpers.ts';
import { isDefined } from '../../../src/request/validators.ts';
import { createTestApp, testAuth } from '../../utils/app.ts';

function echoApp() {
    const { engine } = createTestApp();
    const ctx = buildContext({ engine, auth: testAuth });
    const app = new App();

    app.post('/echo', defineCoreHandler(async (event) => {
        const body = await readJsonBody(event, 16);

        return { body: body === undefined ? '<none>' : body };
    }));
    app.use(createErrorHandler(ctx));

    return app;
}

function post(app: App, body: BodyInit | undefined, headers: Record<string, string> = {}) {
    return app.fetch(new Request('http://test/echo', {
        method: 'POST',
        headers,
        body,
        // a streamed body needs half duplex
        ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit));
}

function streamOf(sizes: number[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const size of sizes) {
                controller.enqueue(new Uint8Array(size).fill(0x20));
            }

            controller.close();
        },
    });
}

describe('readJsonBody', () => {
    it('drains a refused body up to the limit again, keeping the connection', async () => {
        const response = await post(echoApp(), streamOf([10, 10, 10]), { 'content-type': 'application/json' });

        expect(response.status).toBe(413);
        expect(response.headers.get('connection')).toBeNull();
    });

    it('closes the connection after a refused body longer than twice the limit', async () => {
        const response = await post(echoApp(), streamOf([10, 10, 10, 10]), { 'content-type': 'application/json' });

        expect(response.status).toBe(413);
        expect(response.headers.get('connection')).toBe('close');

        const unsupported = await post(echoApp(), streamOf([10, 10, 10]), { 'content-type': 'text/plain' });

        expect(unsupported.status).toBe(415);
        expect(unsupported.headers.get('connection')).toBe('close');
    });

    it('parses a JSON body', async () => {
        const response = await post(echoApp(), '{"a":1}', { 'content-type': 'application/json' });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ body: { a: 1 } });
    });

    it('reads an empty body as undefined', async () => {
        const response = await post(echoApp(), undefined);

        expect(await response.json()).toEqual({ body: '<none>' });
    });

    it('accepts a +json media type', async () => {
        const response = await post(echoApp(), '{"a":1}', { 'content-type': 'application/vnd.api+json; charset=utf-8' });

        expect(response.status).toBe(200);
    });

    it('rejects another media type with 415', async () => {
        const response = await post(echoApp(), '{"a":1}', { 'content-type': 'text/plain' });

        expect(response.status).toBe(415);
    });

    it('refuses another media type at the first chunk and drains at most the limit after it', async () => {
        let pulled = 0;
        // an endless body: only the bounded drain stops reading it
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                controller.enqueue(new TextEncoder().encode('12345678'));
            },
        });
        const response = await post(echoApp(), stream, { 'content-type': 'text/plain' });

        expect(response.status).toBe(415);
        expect(response.headers.get('connection')).toBe('close');
        // the refused chunk, 17 bytes of drain (limit 16), and one chunk pulled ahead
        expect(pulled).toBeLessThanOrEqual(5);
    });

    it('reads an empty body of another media type as undefined', async () => {
        const response = await post(echoApp(), '', { 'content-type': 'text/plain' });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ body: '<none>' });
    });

    it('rejects invalid JSON with 400', async () => {
        const response = await post(echoApp(), '{', { 'content-type': 'application/json' });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ message: 'The request body is not valid JSON.' });
    });

    it('rejects a body over the limit with 413', async () => {
        const response = await post(echoApp(), '{"a":"123456789"}', { 'content-type': 'application/json' });

        expect(response.status).toBe(413);
    });

    it('rejects a streamed body over the limit with 413', async () => {
        const chunks = ['{"a":', '"1234', '56789', '0"}'];
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                const chunk = chunks.shift();

                if (chunk === undefined) {
                    controller.close();
                } else {
                    controller.enqueue(new TextEncoder().encode(chunk));
                }
            },
        });
        const response = await post(echoApp(), stream, { 'content-type': 'application/json' });

        expect(response.status).toBe(413);
    });
});

describe('validateBody', () => {
    const container = () => {
        const c = new Container<{ a?: unknown }>();

        c.mount('a', { optional: true }, isDefined());

        return c;
    };

    it.each([[[1]], ['str'], [null], [5]])('rejects %j', async (body) => {
        const promise = validateBody(container(), body);

        await expect(promise).rejects.toBeInstanceOf(BadRequestError);
        await expect(promise).rejects.toThrow('The request body must be a JSON object.');
    });

    it('reads a missing body as {}', async () => {
        expect(await validateBody(container(), undefined)).toEqual({});
    });

    it('rejects a missing body when required', async () => {
        await expect(validateBody(container(), undefined, { required: true })).rejects.toThrow('The request needs a JSON body.');
    });

    it('drops unknown keys', async () => {
        expect(await validateBody(container(), { a: 1, extra: 2 })).toEqual({ a: 1 });
    });
});

describe('validatePayload', () => {
    it('rejects an invalid payload with issues', async () => {
        const promise = validatePayload(z.object({ n: z.number() }), { n: 'x' });

        await expect(promise).rejects.toBeInstanceOf(BadRequestError);

        const error = await promise.catch((e: unknown) => e) as BadRequestError;

        expect(error.message).toMatch(/^Invalid payload: n: /);
        expect(error.issues[0]).toMatchObject({ path: ['n'] });
    });

    it('accepts an array payload', async () => {
        expect(await validatePayload(z.array(z.string()), ['a'])).toEqual(['a']);
    });

    it('passes the payload through without a schema', async () => {
        const payload = [1, 2];

        expect(await validatePayload(undefined, payload)).toBe(payload);
    });
});
