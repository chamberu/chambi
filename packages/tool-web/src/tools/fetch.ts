/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import {
    decodeBody,
    htmlToMarkdown,
    htmlToText,
    isHtml,
    isText,
    mediaTypeOf,
} from '../html/module.ts';
import type { WebToolsOptionsNormalized } from '../options/types.ts';
import { requestError } from '../request/asserts.ts';
import { getPage } from '../request/module.ts';
import {
    cutText,
    inputObject,
    objectSchema,
    optionalInteger,
    optionalOneOf,
    requireString,
    signalOf,
} from './asserts.ts';
import { UNTRUSTED_NOTE, WEB_FETCH_FORMATS, WEB_FETCH_MAX_CHARS } from './constants.ts';
import type { WebFetchFormat, WebFetchResult } from './types.ts';

type WebFetchInput = {
    url: string;
    format?: WebFetchFormat;
    offset?: number;
};

export function webFetchTool(options: WebToolsOptionsNormalized): Tool<WebFetchInput, WebFetchResult> {
    return defineTool<WebFetchInput, WebFetchResult>({
        description: 'Fetch a public web page or file over http(s): an HTML page as readable markdown (default) or plain text, ' +
            'any other text (JSON, e.g. a package registry such as https://registry.npmjs.org/<name> or ' +
            'https://pypi.org/pypi/<name>/json) as is. ' +
            `Returns at most ${WEB_FETCH_MAX_CHARS} characters from offset; nextOffset names the next page. ${UNTRUSTED_NOTE}`,
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

            const page = await getPage(url, options, signalOf(abortSignal, context));

            if (!isText(page.contentType)) {
                throw requestError(`${page.url.href} is ${mediaTypeOf(page.contentType)}, not text; web_fetch reads text only.`);
            }

            let text = decodeBody(page.bytes, page.contentType);
            const { truncated } = page;
            let title: string | undefined;

            if (format !== 'raw' && isHtml(page.contentType)) {
                const converted = format === 'text' ? htmlToText(text, page.url.href) : htmlToMarkdown(text, page.url.href);

                ({ title } = converted);
                text = converted.content;
            }

            if (offset > 0 && offset >= text.length) {
                throw new ValidationError(`offset ${offset} is past the end (${text.length} characters).`);
            }

            const content = cutText(text, offset, WEB_FETCH_MAX_CHARS);
            const next = offset + content.length;

            return {
                url: page.url.href,
                status: page.status,
                contentType: page.contentType,
                format,
                ...(title !== undefined && { title }),
                content,
                offset,
                totalChars: text.length,
                ...(next < text.length && { nextOffset: next }),
                truncated,
            };
        },
    });
}
