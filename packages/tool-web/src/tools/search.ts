/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { ChamviError, defineTool } from '@chamvi/core';
import { isObject } from 'smob';
import { messageOf, requestError } from '../request/asserts.ts';
import {
    SNIPPET_MAX_CHARS,
    UNTRUSTED_NOTE,
    WEB_SEARCH_DEFAULT_RESULTS,
    WEB_SEARCH_MAX_RESULTS,
} from './constants.ts';
import {
    inputObject,
    objectSchema,
    optionalInteger,
    requireString,
    signalOf,
} from './asserts.ts';
import type { ResolvedWebOptions } from './asserts.ts';
import type { ISearchProvider, SearchResult } from './types.ts';

type WebSearchInput = {
    query: string;
    limit?: number;
};

function isWebUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/** A provider's hit as a result, else undefined (no title or no http(s) url). */
function toResult(value: unknown): SearchResult | undefined {
    if (!isObject(value) || typeof value.title !== 'string' || value.title.trim() === '' || !isWebUrl(value.url)) return undefined;
    const result: SearchResult = { title: value.title, url: value.url };
    if (typeof value.snippet === 'string' && value.snippet.length > 0) result.snippet = value.snippet.slice(0, SNIPPET_MAX_CHARS);
    return result;
}

export function webSearchTool(options: ResolvedWebOptions, provider: ISearchProvider): Tool<WebSearchInput, SearchResult[]> {
    return defineTool<WebSearchInput, SearchResult[]>({
        description: `Search the web; returns up to ${WEB_SEARCH_MAX_RESULTS} hits as { title, url, snippet }. ` +
            `Read a hit with web_fetch. ${UNTRUSTED_NOTE}`,
        inputSchema: objectSchema<WebSearchInput>({
            query: {
                type: 'string',
                minLength: 1,
                description: 'The search query.',
            },
            limit: {
                type: 'integer',
                minimum: 1,
                maximum: WEB_SEARCH_MAX_RESULTS,
                description: `How many hits to return. Default ${WEB_SEARCH_DEFAULT_RESULTS}.`,
            },
        }, ['query']),
        execute: async (input, { abortSignal, context }) => {
            const body = inputObject(input);
            const query = requireString(body.query, 'query');
            const limit = optionalInteger(body.limit, 'limit', 1, WEB_SEARCH_MAX_RESULTS) ?? WEB_SEARCH_DEFAULT_RESULTS;

            const controller = new AbortController();
            const timeout = requestError(`The search provider did not answer within ${options.timeoutMs}ms.`);
            const timer = options.clock.setTimeout(() => controller.abort(timeout), options.timeoutMs);
            const outer = signalOf(abortSignal, context);
            const signal = AbortSignal.any([outer, controller.signal]);
            try {
                const hits = await new Promise<unknown>((resolve, reject) => {
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                    provider.search(query, { limit, signal }).then(resolve, reject);
                });
                if (!Array.isArray(hits)) throw requestError('The search provider answered no list of results.');
                return hits.map(toResult).filter((hit): hit is SearchResult => hit !== undefined).slice(0, limit);
            } catch (error) {
                if (outer.aborted) throw outer.reason;
                if (controller.signal.aborted) throw timeout;
                if (error instanceof ChamviError) throw error;
                throw requestError(`Search failed: ${messageOf(error)}`);
            } finally {
                timer.clear();
            }
        },
    });
}
