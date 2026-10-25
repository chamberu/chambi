/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import { convertHtml } from '../html/convert.ts';
import { HTML_MAX_CHARS } from '../html/constants.ts';
import {
    decodeBody,
    isHtml,
    isText,
    mediaTypeOf,
} from '../html/module.ts';
import { requestError } from '../request/asserts.ts';
import { UNTRUSTED_NOTE, WEB_FETCH_FORMATS, WEB_FETCH_MAX_CHARS } from './constants.ts';
import {
    cutText,
    inputObject,
    objectSchema,
    optionalInteger,
    optionalOneOf,
    requireString,
    signalOf,
} from './asserts.ts';
import type { ResolvedWebOptions } from './asserts.ts';
import type { WebFetchFormat, WebFetchResult } from './types.ts';

type WebFetchInput = {
    url: string;
    format?: WebFetchFormat;
    offset?: number;
};

export function webFetchTool(options: ResolvedWebOptions): Tool<WebFetchInput, WebFetchResult> {
    return defineTool<WebFetchInput, WebFetchResult>({
        description: 'Fetch a public web page or file over http(s): an HTML page as readable markdown (default) or plain text, ' +
            `any other text as is, or the raw body. Returns at most ${WEB_FETCH_MAX_CHARS} characters from offset; ` +
            `nextOffset names the next page. ${UNTRUSTED_NOTE}`,
        inputSchema: objectSchema<WebFetchInput>({
            url: {
                type: 'string',
                minLength: 1,
                description: 'An absolute http or https URL.',
            },
            format: {
                type: 'string',
                enum: [...WEB_FETCH_FORMATS],
                description: 'markdown (default) or text convert an HTML page; raw returns the body unchanged.',
            },
            offset: {
                type: 'integer',
                minimum: 0,
                description: 'The character to start at, from nextOffset of the previous call. Default 0.',
            },
        }, ['url']),
        execute: async (input, { abortSignal, context }) => {
            const body = inputObject(input);
            const url = requireString(body.url, 'url');
            const format = optionalOneOf(body.format, 'format', WEB_FETCH_FORMATS) ?? 'markdown';
            const offset = optionalInteger(body.offset, 'offset', 0) ?? 0;

            const started = options.clock.now().getTime();
            const signal = signalOf(abortSignal, context);
            const response = await options.request(url, {
                signal,
                accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
            });
            const contentType = response.headers.get('content-type');
            if (!isText(contentType)) {
                throw requestError(`${response.url} is ${mediaTypeOf(contentType)}, not text.`);
            }
            const text = decodeBody(response.bytes, contentType);
            let page: { title?: string; content: string } = { content: text };
            let cut = false;
            if (format !== 'raw' && isHtml(contentType)) {
                const html = cutText(text, 0, HTML_MAX_CHARS);
                cut = html.length < text.length;
                page = await convertHtml({
                    html,
                    baseUrl: response.url,
                    format,
                    signal,
                    // the call's timeout covers the conversion too
                    timeoutMs: Math.max(options.timeoutMs - (options.clock.now().getTime() - started), 0),
                    clock: options.clock,
                });
            }

            const totalChars = page.content.length;
            if (offset > totalChars) {
                throw new ValidationError(`offset ${offset} is past the end of the document, which has ${totalChars} characters.`);
            }
            const content = cutText(page.content, offset, WEB_FETCH_MAX_CHARS);
            const next = offset + content.length;
            return {
                url: response.url,
                status: response.status,
                contentType,
                format,
                ...(page.title !== undefined ? { title: page.title } : {}),
                content,
                offset,
                totalChars,
                ...(next < totalChars ? { nextOffset: next } : {}),
                truncated: response.truncated || cut,
            };
        },
    });
}
