/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { pinnedTransport } from '../../../src/request/transport.ts';

describe('pinnedTransport', () => {
    let server: Server;
    let port: number;
    let seen: IncomingMessage[];

    beforeEach(async () => {
        seen = [];
        server = createServer((req, res) => {
            seen.push(req);
            if (req.url === '/gzip') {
                res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
                res.end(gzipSync('packed text'));
                return;
            }
            if (req.url === '/moved') {
                res.writeHead(302, { location: '/elsewhere' });
                res.end();
                return;
            }
            if (req.url === '/empty') {
                res.writeHead(204);
                res.end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['a=1', 'b=2'] });
            res.end(`hello ${req.headers.host}`);
        });
        await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
        port = (server.address() as AddressInfo).port;
    });

    afterEach(async () => {
        await new Promise((resolve) => { server.close(resolve); });
    });

    const init = (signal = new AbortController().signal) => ({
        addresses: [{ address: '127.0.0.1', family: 4 as const }],
        headers: { 'user-agent': 'test' },
        signal,
    });

    it('connects to the given address, whatever the host resolves to', async () => {
        const response = await pinnedTransport(new URL(`http://example.test:${port}/`), init());

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(`hello example.test:${port}`);
        expect(seen[0]!.headers['user-agent']).toBe('test');
        expect(response.headers.get('set-cookie')).toContain('a=1');
    });

    it('falls back to the next checked address', async () => {
        const response = await pinnedTransport(new URL(`http://example.test:${port}/`), {
            ...init(),
            addresses: [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }],
        });

        expect(response.status).toBe(200);
    });

    it('decodes a gzip body', async () => {
        const response = await pinnedTransport(new URL(`http://example.test:${port}/gzip`), init());

        expect(await response.text()).toBe('packed text');
        expect(response.headers.get('content-encoding')).toBeNull();
    });

    it('hands back a redirect without following it', async () => {
        const response = await pinnedTransport(new URL(`http://example.test:${port}/moved`), init());

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/elsewhere');
    });

    it('answers a body-less status', async () => {
        const response = await pinnedTransport(new URL(`http://example.test:${port}/empty`), init());

        expect(response.status).toBe(204);
        expect(response.body).toBeNull();
    });

    it('rejects once the signal aborts', async () => {
        const controller = new AbortController();
        const reason = new Error('stop');
        controller.abort(reason);

        await expect(pinnedTransport(new URL(`http://example.test:${port}/`), init(controller.signal))).rejects.toThrow();
    });
});
