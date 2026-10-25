/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ChamviError } from '@chamvi/core';
import { ValidationError } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { WEB_FETCH_MAX_CHARS, webTools } from '@chamvi/tool-web';
import type { WebFetchResult, WebToolsOptions } from '@chamvi/tool-web';
import { callTool, toolContext } from '../../utils/context.ts';
import { createFakeWeb, html } from '../../utils/web.ts';

function setup(options: WebToolsOptions = {}) {
    const web = createFakeWeb();
    const tools = webTools({
        fetch: web.fetch,
        lookup: web.lookup,
        clock: new ControllableClock(),
        ...options,
    });
    const ctx = toolContext('run-1');
    const fetchPage = (input: unknown) => callTool<WebFetchResult>(tools, 'web_fetch', input, ctx);
    return { web, fetchPage };
}

const PAGE = '<html><head><title>Changelog</title></head><body><main><h2>1.2.0</h2><p>Fixed <a href="/i/1">#1</a>.</p></main></body></html>';

describe('web_fetch', () => {
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
        expect(text.content).toBe('1.2.0\nFixed #1.');
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

    it('checks its input', async () => {
        const { fetchPage } = setup();

        await expect(fetchPage({})).rejects.toThrow(ValidationError);
        await expect(fetchPage({ url: 'https://example.com', format: 'pdf' })).rejects.toThrow(ValidationError);
        await expect(fetchPage({ url: 'https://example.com', offset: -1 })).rejects.toThrow(ValidationError);
        await expect(fetchPage('https://example.com')).rejects.toThrow(ValidationError);
    });
});
