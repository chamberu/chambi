/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Agent, request } from 'node:http';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { serve } from 'routup';
import { ADMIN_TOKEN, createRunTestApp } from '../../utils/app.ts';

type Answer = { status: number; ms: number };

type Send = {
    method: string;
    path: string;
    headers?: Record<string, string>;
    /** Written as chunks (no content-length unless given in headers). */
    chunks?: Buffer[];
};

describe('a refused body on a keep-alive connection', () => {
    let server: ReturnType<typeof serve>;
    let agent: Agent;
    let base: URL;

    beforeEach(async () => {
        const { app } = createRunTestApp();

        server = serve(app, {
            port: 0,
            hostname: '127.0.0.1',
            gracefulShutdown: false,
            silent: true,
        });
        await server.ready();
        base = new URL(server.url!);
        agent = new Agent({ keepAlive: true, maxSockets: 1 });
    });

    afterEach(async () => {
        agent.destroy();
        await server.close(true);
    });

    function send(options: Send): Promise<Answer> {
        const started = Date.now();

        return new Promise((resolve, reject) => {
            const req = request({
                agent,
                host: base.hostname,
                port: base.port,
                method: options.method,
                path: options.path,
                headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...options.headers },
                timeout: 2_000,
            }, (res) => {
                answered = true;
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: Date.now() - started }));
            });
            let answered = false;

            req.on('timeout', () => req.destroy(new Error('timed out')));
            // the server may close while the client still writes a refused body
            req.on('error', (error) => {
                if (!answered) {
                    reject(error);
                }
            });

            for (const chunk of options.chunks ?? []) {
                req.write(chunk);
            }

            req.end();
        });
    }

    const json = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    // 2 MiB, above the default 1 MiB bodyLimit; 900 KiB below it
    const big = () => Array.from({ length: 128 }, () => Buffer.alloc(16 * 1024, 0x20));
    const small = () => Array.from({ length: 56 }, () => Buffer.alloc(16 * 1024, 0x20));

    it.each([
        ['a chunked json body over the limit', {
            method: 'POST',
            path: '/agents/echo/runs',
            headers: json,
            chunks: big(),
        }, 413],
        ['a non-json body', {
            method: 'POST',
            path: '/agents/echo/runs',
            headers: { 'content-type': 'text/plain', 'content-length': String(56 * 16 * 1024) },
            chunks: small(),
        }, 415],
        ['a chunked mcp body over the limit', {
            method: 'POST',
            path: '/mcp',
            headers: json,
            chunks: big(),
        }, 413],
        ['an mcp body whose content-length is over the limit', {
            method: 'POST',
            path: '/mcp',
            headers: { ...json, 'content-length': String(128 * 16 * 1024) },
            chunks: big(),
        }, 413],
    ] as Array<[string, Send, number]>)('does not stall the next request after %s', async (_name, options, status) => {
        expect((await send(options)).status).toBe(status);

        const next = await send({ method: 'GET', path: '/healthz' });

        expect(next.status).toBe(200);
        expect(next.ms).toBeLessThan(1_000);
    });
});
