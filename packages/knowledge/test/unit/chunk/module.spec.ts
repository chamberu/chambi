/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    CHUNKER_VERSION,
    CHUNK_MAX_CHARS,
    CHUNK_OVERLAP_CHARS,
    chunkText,
    contentHash,
} from '@chamvi/knowledge';

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];

function words(length: number): string {
    const parts: string[] = [];
    let size = 0;

    for (let index = 0; size < length; index++) {
        const word = WORDS[index % WORDS.length]!;

        parts.push(word);
        size += word.length + 1;
    }

    return parts.join(' ').slice(0, length).trimEnd();
}

describe('chunkText', () => {
    it('has the documented constants', () => {
        expect(CHUNKER_VERSION).toBe('text-v1');
        expect(CHUNK_MAX_CHARS).toBe(2000);
        expect(CHUNK_OVERLAP_CHARS).toBe(200);
    });

    it('gives no chunk for empty or whitespace-only text', () => {
        expect(chunkText('')).toEqual([]);
        expect(chunkText('  \n\n ')).toEqual([]);
    });

    it('gives one chunk for short text, equal to the trimmed text', () => {
        const text = '  \n  The refund policy applies to every order.\n\nShipping takes two days.  \n';
        const chunks = chunkText(text);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.index).toBe(0);
        expect(chunks[0]!.text).toBe(text.trim());
        expect(text.slice(chunks[0]!.start, chunks[0]!.end)).toBe(chunks[0]!.text);
    });

    it('splits long text into overlapping chunks at whitespace', () => {
        const text = words(5000);
        const chunks = chunkText(text);

        expect(chunks.length).toBeGreaterThan(2);

        for (const [index, chunk] of chunks.entries()) {
            expect(chunk.index).toBe(index);
            expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
            expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
            // breaks only at whitespace: nothing but whitespace (or the text's edge) next to a chunk's ends
            expect(chunk.start === 0 || /\s/.test(text[chunk.start - 1]!)).toBe(true);
            expect(chunk.end === text.length || /\s/.test(text[chunk.end]!)).toBe(true);
        }

        for (let index = 1; index < chunks.length; index++) {
            expect(chunks[index]!.start).toBeLessThan(chunks[index - 1]!.end);
            expect(chunks[index]!.start).toBeGreaterThan(chunks[index - 1]!.start);
        }

        expect(chunks.at(-1)!.end).toBe(text.length);
    });

    it('packs blocks and keeps a heading with the block after it', () => {
        const before = words(1500);
        const section = `# Refunds\n\n${words(800)}`;
        const text = `${before}\n\n${section}\n\n${words(300)}`;
        const chunks = chunkText(text);

        const holding = chunks.filter((chunk) => chunk.text.includes('# Refunds'));

        expect(holding.length).toBeGreaterThan(0);
        expect(holding.some((chunk) => chunk.text.includes(section))).toBe(true);

        for (const chunk of chunks) {
            expect(chunk.text.endsWith('# Refunds')).toBe(false);
            expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
        }
    });

    it('hard-cuts a word over the cap', () => {
        const text = 'a'.repeat(3000);
        const chunks = chunkText(text);

        expect(chunks.map((chunk) => chunk.text.length)).toEqual([2000, 1000]);
        expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    });

    it('never cuts inside a surrogate pair', () => {
        const text = '😀'.repeat(1500);
        const chunks = chunkText(text);

        expect(chunks.length).toBeGreaterThan(1);

        for (const chunk of chunks) {
            const last = chunk.text.charCodeAt(chunk.text.length - 1);
            const first = chunk.text.charCodeAt(0);

            expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
            expect(first >= 0xDC00 && first <= 0xDFFF).toBe(false);
            expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
        }

        expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    });

    it('backs a hard cut off a high surrogate', () => {
        const text = `a${'😀'.repeat(1500)}`;
        const chunks = chunkText(text);

        expect(chunks[0]!.text.length).toBe(1999);
        expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    });
});

describe('contentHash', () => {
    it('is sha256 of the text, prefixed', () => {
        expect(contentHash('a')).toBe(`sha256:${createHash('sha256').update('a').digest('hex')}`);
    });

    it('differs for different texts', () => {
        expect(contentHash('a')).not.toBe(contentHash('b'));
        expect(contentHash('')).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
});
