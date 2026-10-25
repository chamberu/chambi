/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ChamviError, ValidationError } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { createRequester } from '../../../src/request/module.ts';
import type { RequesterOptions } from '../../../src/request/types.ts';
import {
    PUBLIC,
    createFakeWeb,
    hang,
    html,
    redirect,
} from '../../utils/web.ts';

function setup(options: Partial<RequesterOptions> = {}) {
    const web = createFakeWeb();
    const clock = new ControllableClock();
    const request = createRequester({
        transport: web.transport,
        lookup: web.lookup,
        maxBytes: 1024,
        timeoutMs: 5_000,
        clock,
        ...options,
    });
    const { signal } = new AbortController();
    return {
        web,
        clock,
        request,
        signal,
    };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a failure');
}

describe('createRequester', () => {
    it('fetches a public URL through the checked address', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.routes.set('https://example.com/a', html('<p>hi</p>'));

        const response = await request('https://example.com/a', { signal });

        expect(response.status).toBe(200);
        expect(response.url).toBe('https://example.com/a');
        expect(new TextDecoder().decode(response.bytes)).toBe('<p>hi</p>');
        expect(response.truncated).toBe(false);
        expect(web.calls).toEqual([expect.objectContaining({ url: 'https://example.com/a', address: PUBLIC })]);
        expect(web.calls[0]!.headers['user-agent']).toMatch(/chamvi/);
    });

    it('refuses a host that resolves to a private address before any request', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.dns.set('intranet.example', [{ address: '10.0.0.5', family: 4 }]);

        const error = await failure(request('http://intranet.example/', { signal }));

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toMatch(/non-public address 10\.0\.0\.5/);
        expect(web.calls).toEqual([]);
    });

    it('refuses a host whose answer mixes a public and a private address', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.dns.set('mixed.example', [PUBLIC, { address: '::1', family: 6 }]);

        await expect(request('http://mixed.example/', { signal })).rejects.toThrow(ValidationError);
        expect(web.calls).toEqual([]);
    });

    it('checks an IP literal without a lookup', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();

        await expect(request('http://[::ffff:169.254.169.254]/latest/meta-data', { signal })).rejects.toThrow(ValidationError);
        await expect(request('http://2130706433/', { signal })).rejects.toThrow(ValidationError);
        expect(web.lookups).toEqual([]);
    });

    it('refuses other schemes, credentials and relative URLs', async () => {
        const { request, signal } = setup();

        await expect(request('file:///etc/passwd', { signal })).rejects.toThrow(ValidationError);
        await expect(request('ftp://example.com/x', { signal })).rejects.toThrow(ValidationError);
        await expect(request('https://user:pw@example.com/', { signal })).rejects.toThrow(ValidationError);
        await expect(request('/relative', { signal })).rejects.toThrow(ValidationError);
    });

    it('follows redirects by hand and reports the final URL', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.routes.set('http://example.com/', redirect('https://example.com/', 301));
        web.routes.set('https://example.com/', redirect('/docs', 302));
        web.routes.set('https://example.com/docs', html('docs'));

        const response = await request('http://example.com/', { signal });

        expect(response.url).toBe('https://example.com/docs');
        expect(web.calls.map((call) => call.url)).toEqual([
            'http://example.com/',
            'https://example.com/',
            'https://example.com/docs',
        ]);
    });

    it('re-checks every redirect hop', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.routes.set('https://example.com/a', redirect('http://169.254.169.254/latest/meta-data/'));
        web.routes.set('https://example.com/b', redirect('file:///etc/passwd'));
        web.dns.set('evil.example', [{ address: '127.0.0.1', family: 4 }]);
        web.routes.set('https://example.com/c', redirect('https://evil.example/'));

        await expect(request('https://example.com/a', { signal })).rejects.toThrow(ValidationError);
        await expect(request('https://example.com/b', { signal })).rejects.toThrow(ValidationError);
        await expect(request('https://example.com/c', { signal })).rejects.toThrow(ValidationError);
        expect(web.calls.map((call) => call.url)).toEqual([
            'https://example.com/a',
            'https://example.com/b',
            'https://example.com/c',
        ]);
    });

    it('stops after five redirects', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        for (let i = 0; i < 6; i++) {
            web.routes.set(`https://example.com/${i}`, redirect(`/${i + 1}`));
        }
        web.routes.set('https://example.com/6', html('end'));
        web.routes.set('https://example.com/x', redirect('/2'));

        const error = await failure(request('https://example.com/0', { signal }));
        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe('web_request');
        expect(error.message).toMatch(/more than 5 redirects/);

        expect((await request('https://example.com/x', { signal })).url).toBe('https://example.com/6');
    });

    it('lets allowUrl open a private address and refuse a public one', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup({
            allowUrl: (url) => {
                if (url.hostname === 'localhost') return true;
                if (url.hostname === 'blocked.example') return false;
                return undefined;
            },
        });
        web.dns.set('localhost', [{ address: '127.0.0.1', family: 4 }]);
        web.routes.set('http://localhost:3000/', html('local'));

        expect((await request('http://localhost:3000/', { signal })).status).toBe(200);
        expect(web.calls[0]!.address).toEqual({ address: '127.0.0.1', family: 4 });
        await expect(request('https://blocked.example/', { signal })).rejects.toThrow(/not allowed/);
    });

    it('skips the address check for trusted origins', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.dns.set('registry.internal', [{ address: '10.0.0.9', family: 4 }]);
        web.routes.set('https://registry.internal/pkg', html('{}', 'application/json'));

        const response = await request('https://registry.internal/pkg', { signal, trusted: ['https://registry.internal'] });
        expect(response.status).toBe(200);
    });

    it('fails with web_request for an error status', async () => {
        const { request, signal } = setup();

        const error = await failure(request('https://example.com/missing', { signal }));
        expect((error as ChamviError).code).toBe('web_request');
        expect(error.message).toBe('HTTP 404 from https://example.com/missing');
    });

    it('fails with web_request for a host without an address', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.dns.set('nowhere.example', []);

        const error = await failure(request('https://nowhere.example/', { signal }));
        expect((error as ChamviError).code).toBe('web_request');
    });

    it('reads at most maxBytes', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup({ maxBytes: 10 });
        web.routes.set('https://example.com/big', html('0123456789abcdef'));
        web.routes.set('https://example.com/exact', html('0123456789'));

        const big = await request('https://example.com/big', { signal });
        expect(new TextDecoder().decode(big.bytes)).toBe('0123456789');
        expect(big.truncated).toBe(true);

        const exact = await request('https://example.com/exact', { signal });
        expect(exact.truncated).toBe(false);

        const wider = await request('https://example.com/big', { signal, maxBytes: 100 });
        expect(wider.truncated).toBe(false);
    });

    it('aborts a stalled request after timeoutMs on the clock', async () => {
        const {
            web, 
            clock, 
            request, 
            signal, 
        } = setup();
        web.routes.set('https://slow.example/', hang);

        const pending = failure(request('https://slow.example/', { signal }));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        clock.advance(5_000);
        const error = await pending;

        expect((error as ChamviError).code).toBe('web_request');
        expect(error.message).toBe('No answer from https://slow.example within 5000ms.');
    });

    it('passes the caller\'s abort reason', async () => {
        const { web, request } = setup();
        web.routes.set('https://slow.example/', hang);
        const controller = new AbortController();

        const pending = failure(request('https://slow.example/', { signal: controller.signal }));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        const reason = new Error('cancelled');
        controller.abort(reason);

        expect(await pending).toBe(reason);
    });

    it('wraps a transport failure without its details', async () => {
        const {
            web, 
            request, 
            signal, 
        } = setup();
        web.routes.set('https://broken.example/', () => { throw new TypeError('socket hang up'); });

        const error = await failure(request('https://broken.example/', { signal }));
        expect((error as ChamviError).code).toBe('web_request');
        expect(error.message).toBe('Request to https://broken.example failed: socket hang up');
    });
});
