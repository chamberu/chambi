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
import type { ChamviError, IClock } from '@chamvi/core';
import { systemClock } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { webTools } from '@chamvi/tool-web';
import type { WebFetchResult, WebToolsOptions } from '@chamvi/tool-web';
import { HTML_MAX_CHARS, HTML_MAX_DEPTH } from '../../../src/html/constants.ts';
import { callTool, toolContext } from '../../utils/context.ts';
import { createFakeWeb, html } from '../../utils/web.ts';

const BLOCK = '<h2>Release 1.2.3</h2><p>Fixed <a href="/i/1">issue one</a> and more text to fill the line.</p><ul><li>one</li><li>two</li></ul>';

/** An ordinary page of headings, paragraphs, links and lists of at least `chars` characters. */
function largePage(chars: number): string {
    return `<html><head><title>Notes</title></head><body>${BLOCK.repeat(Math.ceil(chars / BLOCK.length))}</body></html>`;
}

function nested(depth: number): string {
    return `<html><body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body></html>`;
}

/** The clock, recording the delay of every timer armed on it. */
function recording(clock: IClock): { clock: IClock; armed: number[] } {
    const armed: number[] = [];
    return {
        armed,
        clock: {
            now: () => clock.now(),
            setTimeout: (fn, ms, opts) => {
                armed.push(ms);
                return clock.setTimeout(fn, ms, opts);
            },
        },
    };
}

function setup(options: WebToolsOptions = {}) {
    const web = createFakeWeb();
    const tools = webTools({
        fetch: web.fetch,
        lookup: web.lookup,
        clock: new ControllableClock(),
        ...options,
    });
    const ctx = toolContext('run-1');
    const fetchPage = (input: unknown, signal?: AbortSignal) => callTool<WebFetchResult>(tools, 'web_fetch', input, ctx, signal);
    return { web, fetchPage };
}

describe('web_fetch conversion', () => {
    it('converts a large page off the event loop and only its first HTML_MAX_CHARS characters', async () => {
        const { web, fetchPage } = setup({ clock: systemClock });
        const page = largePage(HTML_MAX_CHARS * 1.5);
        web.routes.set('https://example.com/notes', html(page));

        let last = performance.now();
        let longestGap = 0;
        const interval = setInterval(() => {
            const now = performance.now();
            longestGap = Math.max(longestGap, now - last);
            last = now;
        }, 10);
        const started = performance.now();
        try {
            const result = await fetchPage({ url: 'https://example.com/notes' });
            expect(result.title).toBe('Notes');
            expect(result.content.startsWith('## Release 1.2.3')).toBe(true);
            expect(result.truncated).toBe(true);
        } finally {
            clearInterval(interval);
        }
        // a timer of the caller's event loop kept firing while the page converted
        expect(longestGap).toBeLessThan(500);
        expect(performance.now() - started).toBeLessThan(15_000);
    });

    it('keeps the full body for raw and text formats', async () => {
        const { web, fetchPage } = setup();
        const page = largePage(HTML_MAX_CHARS + 1000);
        web.routes.set('https://example.com/notes', html(page));

        const raw = await fetchPage({ url: 'https://example.com/notes', format: 'raw' });
        expect(raw.totalChars).toBe(page.length);
        expect(raw.truncated).toBe(false);
    });

    it('bounds a conversion by the rest of the request timeout', async () => {
        const base = new ControllableClock();
        const { clock, armed } = recording(base);
        const { web, fetchPage } = setup({ clock, timeoutMs: 30_000 });
        web.routes.set('https://example.com/notes', () => {
            base.advance(10_000);
            return html(largePage(HTML_MAX_CHARS))(new URL('https://example.com/notes'), new AbortController().signal);
        });

        const result = fetchPage({ url: 'https://example.com/notes' }).catch((e: unknown) => e);
        await vi.waitFor(() => expect(armed).toHaveLength(2));
        expect(armed).toEqual([30_000, 20_000]);
        base.advance(20_000);

        const error = await result as ChamviError;
        expect(error.code).toBe('web_request');
        expect(error.message).toMatch(/https:\/\/example\.com\/notes.*20000ms/);
    });

    it('stops a conversion when the call is aborted', async () => {
        const base = new ControllableClock();
        const { clock, armed } = recording(base);
        const { web, fetchPage } = setup({ clock });
        web.routes.set('https://example.com/notes', html(largePage(HTML_MAX_CHARS)));
        const controller = new AbortController();
        const reason = new Error('stop');

        const started = performance.now();
        const result = fetchPage({ url: 'https://example.com/notes' }, controller.signal).catch((e: unknown) => e);
        await vi.waitFor(() => expect(armed).toHaveLength(2));
        controller.abort(reason);

        expect(await result).toBe(reason);
        expect(performance.now() - started).toBeLessThan(1_500);
    });

    it('refuses a page nested deeper than HTML_MAX_DEPTH elements before parsing it', async () => {
        const { web, fetchPage } = setup();
        web.routes.set('https://example.com/deep', html(nested(HTML_MAX_DEPTH + 1)));
        web.routes.set('https://example.com/ok', html(nested(HTML_MAX_DEPTH)));

        const error = await fetchPage({ url: 'https://example.com/deep' }).catch((e: unknown) => e) as ChamviError;
        expect(error.code).toBe('web_request');
        expect(error.message).toMatch(/deeper than 512.*format raw/);

        expect((await fetchPage({ url: 'https://example.com/deep', format: 'raw' })).content).toContain('deep');
        expect((await fetchPage({ url: 'https://example.com/ok' })).content).toBe('deep');
        expect((await fetchPage({ url: 'https://example.com/ok', format: 'text' })).content).toBe('deep');
    });
});
