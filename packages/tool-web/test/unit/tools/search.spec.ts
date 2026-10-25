/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ChamviError } from '@chamvi/core';
import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { WEB_SEARCH_MAX_RESULTS, webTools } from '@chamvi/tool-web';
import type { ISearchProvider, SearchResult } from '@chamvi/tool-web';
import { callTool, toolContext } from '../../utils/context.ts';

function setup(search: ISearchProvider['search']) {
    const clock = new ControllableClock();
    const calls: Array<{
        query: string; 
        limit: number; 
        signal: AbortSignal 
    }> = [];
    const tools = webTools({
        clock,
        timeoutMs: 1_000,
        search: {
            search: (query, options) => {
                calls.push({ query, ...options });
                return search(query, options);
            },
        },
    });
    const ctx = toolContext('run-1');
    const run = (input: unknown) => callTool<SearchResult[]>(tools, 'web_search', input, ctx);
    return {
        clock,
        calls,
        tools,
        run,
    };
}

const hit = (n: number): SearchResult => ({
    title: `Result ${n}`, 
    url: `https://example.com/${n}`, 
    snippet: `snippet ${n}`, 
});

describe('web_search', () => {
    it('exists only with a search provider', () => {
        expect(webTools()).not.toHaveProperty('web_search');
        expect(setup(async () => []).tools).toHaveProperty('web_search');
        expect(() => webTools({ search: {} as never })).toThrow(InvalidAgentDefinitionError);
    });

    it('marks its results as untrusted web content', () => {
        expect(setup(async () => []).tools.web_search!.description).toMatch(/untrusted/i);
    });

    it('asks the provider with the limit and returns its results', async () => {
        const { calls, run } = setup(async () => [hit(1), hit(2)]);

        expect(await run({ query: 'vitest 5 breaking changes', limit: 2 })).toEqual([hit(1), hit(2)]);
        expect(calls[0]).toMatchObject({ query: 'vitest 5 breaking changes', limit: 2 });
        expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
    });

    it('defaults to ten results and cuts what the provider oversends', async () => {
        const { calls, run } = setup(async () => Array.from({ length: 30 }, (_, i) => hit(i)));

        expect(await run({ query: 'x' })).toHaveLength(10);
        expect(calls[0]!.limit).toBe(10);
    });

    it('drops entries without a title or an http(s) url and cuts long snippets', async () => {
        const { run } = setup(async () => [
            { title: '', url: 'https://example.com/a' },
            { title: 'no url' } as SearchResult,
            { title: 'script', url: ['javascript', 'void(0)'].join(':') },
            {
                title: 'ok', 
                url: 'https://example.com/ok', 
                snippet: 'x'.repeat(2_000), 
            },
            {
                title: 'plain', 
                url: 'http://example.com/plain', 
                snippet: 7 as never, 
            },
        ]);

        const results = await run({ query: 'x' });
        expect(results.map((r) => r.title)).toEqual(['ok', 'plain']);
        expect(results[0]!.snippet).toHaveLength(1_000);
        expect(results[1]).toEqual({ title: 'plain', url: 'http://example.com/plain' });
    });

    it('wraps a provider failure', async () => {
        const { run } = setup(async () => { throw new TypeError('quota exceeded'); });

        const error = await run({ query: 'x' }).catch((e: unknown) => e) as ChamviError;
        expect(error.code).toBe('web_request');
        expect(error.message).toBe('Search failed: quota exceeded');
    });

    it('fails a provider that answers no array', async () => {
        const { run } = setup(async () => ({}) as never);

        await expect(run({ query: 'x' })).rejects.toThrow(/no list/);
    });

    it('aborts a stalled provider after timeoutMs', async () => {
        const { clock, run } = setup((_query, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));

        const pending = run({ query: 'x' }).catch((e: unknown) => e);
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        clock.advance(1_000);
        expect(((await pending) as Error).message).toBe('The search provider did not answer within 1000ms.');
    });

    it('checks its input', async () => {
        const { run } = setup(async () => []);

        await expect(run({ query: ' ' })).rejects.toThrow(ValidationError);
        await expect(run({ query: 'x', limit: WEB_SEARCH_MAX_RESULTS + 1 })).rejects.toThrow(ValidationError);
    });
});
