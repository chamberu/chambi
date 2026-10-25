/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import {
    FOREIGN_BREAKOUT_ELEMENTS,
    FOREIGN_ELEMENTS,
    HTML_INTEGRATION_ELEMENTS,
    OPTIONAL_END_ELEMENTS,
    RAW_TEXT_ELEMENTS,
    VOID_ELEMENTS,
} from './constants.ts';
import type { ConvertReply } from './types.ts';

type Scope = {
    name: string,
    depth: number,
    foreign: boolean,
};

/**
 * How deep the elements of `html` nest, from its tags in one linear pass
 * (no parse): void and optional-end elements do not nest, comments and raw
 * text (scripts, styles) are skipped, a stray end tag never goes below zero.
 * A self-closed tag (`<div/>`) opens an element, as an HTML parser ignores
 * the flag, except in svg and math content, where it closes (outside their
 * HTML integration points, and until an HTML element breaks out of them).
 * An estimate for refusing a hostile page cheaply: where it guesses, it
 * counts too deep rather than too shallow.
 */
export function nestingDepth(html: string): number {
    const source = html.toLowerCase();
    let depth = 0;
    let max = 0;
    let index = 0;
    const scopes: Scope[] = [];
    for (;;) {
        const start = source.indexOf('<', index);
        if (start < 0) return max;
        if (source.startsWith('<!--', start)) {
            const end = source.indexOf('-->', start + 4);
            if (end < 0) return max;
            index = end + 3;
            continue;
        }
        const end = source.indexOf('>', start + 1);
        if (end < 0) return max;
        index = end + 1;

        const closing = source.charCodeAt(start + 1) === 47; // '/'
        const name = /^[a-z][^\s/>]*/.exec(source.slice(start + (closing ? 2 : 1), end))?.[0];
        if (!name) continue;
        if (!closing && FOREIGN_BREAKOUT_ELEMENTS.has(name) && scopes.at(-1)?.foreign) {
            // an HTML element ends the svg or math content it appears in
            while (scopes.at(-1)?.foreign) depth = scopes.pop()!.depth - 1;
        }
        const foreign = scopes.at(-1)?.foreign ?? false;
        if (!foreign && (VOID_ELEMENTS.has(name) || OPTIONAL_END_ELEMENTS.has(name))) continue;
        if (closing) {
            depth = Math.max(depth - 1, 0);
            if (scopes.at(-1)?.name === name) scopes.pop();
            continue;
        }
        const selfClosed = source.charCodeAt(end - 1) === 47; // '/>'
        const entersForeign = !foreign && FOREIGN_ELEMENTS.has(name);
        if (selfClosed && (foreign || entersForeign)) continue;
        depth++;
        max = Math.max(max, depth);
        if (entersForeign) {
            scopes.push({
                name,
                depth,
                foreign: true,
            });
        } else if (foreign && HTML_INTEGRATION_ELEMENTS.has(name)) {
            scopes.push({
                name,
                depth,
                foreign: false,
            });
        }
        if (!foreign && RAW_TEXT_ELEMENTS.has(name)) {
            const close = source.indexOf(`</${name}`, index);
            if (close < 0) return max;
            index = close;
        }
    }
}

/**
 * Whether a message of the conversion worker is its ConvertReply. Node posts
 * messages of its own from every worker (`{ 'watch:import': [...] }` under
 * `node --watch`, which `chamvi dev` runs), so the caller skips any other.
 */
export function isConvertReply(message: unknown): message is ConvertReply {
    if (!isObject(message)) return false;
    if ('page' in message) return isObject(message.page) && typeof message.page.content === 'string';
    return 'error' in message && typeof message.error === 'string';
}
