/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { OPTIONAL_END_ELEMENTS, RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from './constants.ts';

/**
 * How deep the elements of `html` nest, from its tags in one linear pass
 * (no parse): void, self-closed and optional-end elements do not nest,
 * comments and raw text (scripts, styles) are skipped, a stray end tag never
 * goes below zero. An estimate for refusing a hostile page cheaply.
 */
export function nestingDepth(html: string): number {
    const source = html.toLowerCase();
    let depth = 0;
    let max = 0;
    let index = 0;
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
        if (!name || VOID_ELEMENTS.has(name) || OPTIONAL_END_ELEMENTS.has(name)) continue;
        if (closing) {
            depth = Math.max(depth - 1, 0);
            continue;
        }
        if (source.charCodeAt(end - 1) === 47) continue; // '/>'
        depth++;
        max = Math.max(max, depth);
        if (RAW_TEXT_ELEMENTS.has(name)) {
            const close = source.indexOf(`</${name}`, index);
            if (close < 0) return max;
            index = close;
        }
    }
}
