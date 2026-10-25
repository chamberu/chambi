/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { nestingDepth } from '../../../src/html/asserts.ts';

describe('nestingDepth', () => {
    it('counts nested elements', () => {
        expect(nestingDepth('')).toBe(0);
        expect(nestingDepth('plain text')).toBe(0);
        expect(nestingDepth('<html><body><div><span>a</span></div><p>b</p></body></html>')).toBe(2);
        expect(nestingDepth('<DIV><Div>a</DIV></div>')).toBe(2);
    });

    it('skips void, self-closed and optional-end elements', () => {
        expect(nestingDepth('<div><br><img src="a"><input/><svg><path d="M0"/></svg></div>')).toBe(2);
        expect(nestingDepth(`<ul>${'<li>item'.repeat(1000)}</ul>`)).toBe(1);
        expect(nestingDepth(`<div>${'<p>para'.repeat(1000)}</div>`)).toBe(1);
    });

    it('skips comments and the content of raw text elements', () => {
        expect(nestingDepth(`<div><!-- ${'<div>'.repeat(100)} --></div>`)).toBe(1);
        expect(nestingDepth(`<script>${'"<div>"+'.repeat(100)}</script><div></div>`)).toBe(1);
        expect(nestingDepth(`<style>${'<div>'.repeat(100)}</STYLE>`)).toBe(1);
    });

    it('never goes below zero on stray end tags', () => {
        expect(nestingDepth('</div></div><div><div></div></div>')).toBe(2);
    });

    it('stays linear on unterminated tags and comments', () => {
        const started = performance.now();
        nestingDepth('<'.repeat(1_048_576));
        nestingDepth('<a'.repeat(524_288));
        nestingDepth(`${'<'.repeat(524_288)}>`);
        nestingDepth('<!--'.repeat(262_144));
        nestingDepth(`<script>${'<div>'.repeat(200_000)}`);
        expect(performance.now() - started).toBeLessThan(1_000);
    });
});
