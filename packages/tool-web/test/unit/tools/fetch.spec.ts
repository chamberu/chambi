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
import type { Tool } from 'ai';
import type { ChamviError, ToolTrust } from '@chamvi/core';
import { ValidationError } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    WEB_FETCH_MAX_CHARS,
    WEB_MAX_REDIRECTS,
    WEB_REQUEST_ERROR_CODE,
    webTools,
} from '@chamvi/tool-web';
import type { WebFetchResult, WebToolsOptions } from '@chamvi/tool-web';
import { callTool, toolContext } from '../../utils/context.ts';
import {
    createFakeWeb,
    hang,
    html,
    redirect,
    text,
} from '../../utils/web.ts';

function setup(options: WebToolsOptions = {}) {
    const web = createFakeWeb();
    const clock = new ControllableClock();
    const tools = webTools({
        client: web.client,
        lookup: web.lookup,
        clock,
        ...options,
    });
    const ctx = toolContext('run-1');
    const fetchPage = (input: unknown) => callTool<WebFetchResult>(tools, 'web_fetch', input, ctx);

    return {
        web,
        clock,
        fetchPage,
    };
}

function codeOf(error: unknown): string | undefined {
    return (error as ChamviError).code;
}

const PAGE = '<html><head><title>Changelog</title></head><body><main><h2>1.2.0</h2><p>Fixed <a href="/i/1">#1</a>.</p></main></body></html>';

describe('web_fetch', () => {
    it('classifies page contents as untrusted and leaves request URLs ungated', () => {
        const tool = webTools().web_fetch as Tool & { trust: ToolTrust };

        expect(tool.trust).toEqual({ taint: true });
    });

    it('returns a page as markdown with its title', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/changelog', html(PAGE));

        expect(await fetchPage({ url: 'https://example.com/changelog' })).toEqual({
            url: 'https://example.com/changelog',
            status: 200,
            contentType: 'text/html; charset=utf-8',
            format: 'markdown',
            title: 'Changelog',
            content: '## 1.2.0\n\nFixed [#1](https://example.com/i/1).',
            offset: 0,
            totalChars: 46,
            truncated: false,
        });
    });

    it('returns plain text and the raw body on request', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/changelog', html(PAGE));

        const text = await fetchPage({ url: 'https://example.com/changelog', format: 'text' });

        expect(text.content).toBe('1.2.0\n\nFixed #1.');
        expect(text.format).toBe('text');

        const raw = await fetchPage({ url: 'https://example.com/changelog', format: 'raw' });

        expect(raw.content).toBe(PAGE);
        expect(raw.title).toBeUndefined();
    });

    it('passes text formats through unconverted', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/CHANGELOG.md', html('# 1.0.0\n\n- <b>bold</b>', 'text/markdown'));
        web.routes.set('https://example.com/data.json', html('{"a":1}', 'application/json'));

        expect((await fetchPage({ url: 'https://example.com/CHANGELOG.md' })).content).toBe('# 1.0.0\n\n- <b>bold</b>');
        expect((await fetchPage({ url: 'https://example.com/data.json' })).content).toBe('{"a":1}');
    });

    it('pages through a long document by offset', async () => {
        const { web, fetchPage } = setup();
        const long = 'a'.repeat(WEB_FETCH_MAX_CHARS + 10);

        web.routes.set('https://example.com/long.txt', html(long, 'text/plain'));

        const first = await fetchPage({ url: 'https://example.com/long.txt' });

        expect(first.content).toHaveLength(WEB_FETCH_MAX_CHARS);
        expect(first.totalChars).toBe(WEB_FETCH_MAX_CHARS + 10);
        expect(first.nextOffset).toBe(WEB_FETCH_MAX_CHARS);

        const second = await fetchPage({ url: 'https://example.com/long.txt', offset: first.nextOffset });

        expect(second.content).toBe('a'.repeat(10));
        expect(second.offset).toBe(WEB_FETCH_MAX_CHARS);
        expect(second.nextOffset).toBeUndefined();
    });

    it('never cuts a surrogate pair', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/emoji.txt', html(`${'a'.repeat(WEB_FETCH_MAX_CHARS - 1)}😀b`, 'text/plain'));

        const first = await fetchPage({ url: 'https://example.com/emoji.txt' });

        expect(first.content).toHaveLength(WEB_FETCH_MAX_CHARS - 1);
        expect(first.nextOffset).toBe(WEB_FETCH_MAX_CHARS - 1);
    });

    it('refuses an offset past the end', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/short.txt', html('short', 'text/plain'));

        await expect(fetchPage({ url: 'https://example.com/short.txt', offset: 6 })).rejects.toThrow(ValidationError);
    });

    it('reports a body cut at maxBytes', async () => {
        const { web, fetchPage } = setup({ maxBytes: 4 });

        web.routes.set('https://example.com/short.txt', html('longer', 'text/plain'));

        const result = await fetchPage({ url: 'https://example.com/short.txt' });

        expect(result.content).toBe('long');
        expect(result.truncated).toBe(true);
    });

    it('refuses a binary response', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/logo.png', html('PNG', 'image/png'));

        const error = await fetchPage({ url: 'https://example.com/logo.png' }).catch((e: unknown) => e);

        expect((error as ChamviError).code).toBe('web_request');
        expect((error as Error).message).toMatch(/image\/png/);
    });

    it('refuses private addresses unless allowUrl allows them', async () => {
        const { web, fetchPage } = setup();

        web.dns.set('localhost', [{ address: '127.0.0.1', family: 4 }]);

        await expect(fetchPage({ url: 'http://localhost/' })).rejects.toThrow(ValidationError);
        expect(web.calls).toEqual([]);

        const open = setup({ allowUrl: () => true });

        open.web.dns.set('localhost', [{ address: '127.0.0.1', family: 4 }]);
        open.web.routes.set('http://localhost/', html('<p>local</p>'));
        expect((await open.fetchPage({ url: 'http://localhost/' })).content).toBe('local');
    });

    it('follows redirects, checking every target', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/a', redirect('/b', 301));
        web.routes.set('https://example.com/b', redirect('https://other.example/c'));
        web.routes.set('https://other.example/c', text('done'));

        expect(await fetchPage({ url: 'https://example.com/a' })).toMatchObject({ url: 'https://other.example/c', content: 'done' });
        expect(web.lookups).toEqual(['example.com', 'example.com', 'other.example']);
    });

    it('answers a malformed redirect target as a web_request tool error', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/a', redirect('http://['));

        const error = await fetchPage({ url: 'https://example.com/a' }).catch((e: unknown) => e);

        expect(codeOf(error)).toBe(WEB_REQUEST_ERROR_CODE);
        expect((error as Error).message).toMatch(/redirect/i);
    });

    it('refuses a redirect to a private address before requesting it', async () => {
        const { web, fetchPage } = setup();

        web.dns.set('metadata.internal', [{ address: '169.254.169.254', family: 4 }]);
        web.routes.set('https://example.com/a', redirect('http://metadata.internal/latest'));

        await expect(fetchPage({ url: 'https://example.com/a' })).rejects.toThrow(ValidationError);
        expect(web.calls).toEqual(['https://example.com/a']);
    });

    it(`stops after ${WEB_MAX_REDIRECTS} redirects`, async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/loop', redirect('/loop'));

        const error = await fetchPage({ url: 'https://example.com/loop' }).catch((e: unknown) => e);

        expect(codeOf(error)).toBe(WEB_REQUEST_ERROR_CODE);
        expect(web.calls).toHaveLength(WEB_MAX_REDIRECTS + 1);
    });

    it('answers an error status and a failed request as a web_request tool error', async () => {
        const { web, fetchPage } = setup();

        web.routes.set('https://example.com/gone', text('gone', 410));
        web.routes.set('https://example.com/down', () => {
            throw new TypeError('fetch failed');
        });

        const gone = await fetchPage({ url: 'https://example.com/gone' }).catch((e: unknown) => e);

        expect(codeOf(gone)).toBe(WEB_REQUEST_ERROR_CODE);
        expect((gone as Error).message).toMatch(/410/);

        const down = await fetchPage({ url: 'https://example.com/down' }).catch((e: unknown) => e);

        expect(codeOf(down)).toBe(WEB_REQUEST_ERROR_CODE);
        expect((down as Error).message).toMatch(/fetch failed/);
    });

    it('gives up after timeoutMs on the clock', async () => {
        const {
            web,
            clock,
            fetchPage,
        } = setup({ timeoutMs: 5_000 });

        web.routes.set('https://example.com/slow', hang);

        const pending = fetchPage({ url: 'https://example.com/slow' }).catch((e: unknown) => e);

        await vi.waitFor(() => expect(web.calls).toHaveLength(1));
        clock.advance(5_000);

        const error = await pending;

        expect(codeOf(error)).toBe(WEB_REQUEST_ERROR_CODE);
        expect((error as Error).message).toMatch(/5000ms/);
    });

    it('checks its input', async () => {
        const { fetchPage } = setup();

        await expect(fetchPage({})).rejects.toThrow(ValidationError);
        await expect(fetchPage({ url: 'https://example.com', format: 'pdf' })).rejects.toThrow(ValidationError);
        await expect(fetchPage({ url: 'https://example.com', offset: -1 })).rejects.toThrow(ValidationError);
        await expect(fetchPage('https://example.com')).rejects.toThrow(ValidationError);
    });
});
