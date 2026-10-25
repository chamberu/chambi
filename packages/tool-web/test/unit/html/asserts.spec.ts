/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { isConvertReply, nestingDepth } from '../../../src/html/asserts.ts';

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

    it('counts a self-closed non-void element as open, as an HTML parser does', () => {
        expect(nestingDepth('<div/>'.repeat(1000))).toBe(1000);
        expect(nestingDepth(`<div>${'<span/>'.repeat(5)}</div>`)).toBe(6);
    });

    it('honours self-closing in svg and math, but not in their HTML parts', () => {
        expect(nestingDepth(`<svg>${'<path d="M0"/>'.repeat(1000)}</svg><math>${'<mi/>'.repeat(1000)}</math>`)).toBe(1);
        expect(nestingDepth('<svg/><math/><div/>')).toBe(1);
        expect(nestingDepth(`<svg>${'<g>'.repeat(600)}`)).toBe(601);
        expect(nestingDepth(`<svg><foreignObject>${'<div/>'.repeat(100)}</foreignObject></svg>`)).toBe(102);
        expect(nestingDepth(`<svg><g><div>${'<div/>'.repeat(100)}`)).toBe(101);
        expect(nestingDepth(`<svg><style>${'<g>'.repeat(100)}`)).toBe(102);
        expect(nestingDepth(`<svg><path/></svg>${'<div/>'.repeat(10)}`)).toBe(10);
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

describe('isConvertReply', () => {
    it('takes a page or an error and skips the messages node posts itself', () => {
        expect(isConvertReply({ page: { content: 'hi' } })).toBe(true);
        expect(isConvertReply({ page: { title: 'T', content: '' } })).toBe(true);
        expect(isConvertReply({ error: 'broken' })).toBe(true);

        expect(isConvertReply({ 'watch:import': ['file:///app/worker.mjs'] })).toBe(false);
        expect(isConvertReply({ 'watch:require': ['/app/a.cjs'] })).toBe(false);
        expect(isConvertReply({ page: 'hi' })).toBe(false);
        expect(isConvertReply({ error: undefined })).toBe(false);
        expect(isConvertReply(undefined)).toBe(false);
        expect(isConvertReply('page')).toBe(false);
    });
});
