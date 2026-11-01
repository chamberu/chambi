/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS } from './constants.ts';
import type { KnowledgeChunk } from './types.ts';

type Span = { start: number; end: number };

/** One or more blank (whitespace-only) lines. */
const BLOCK_SEPARATOR = /\n(?:[^\S\n]*\n)+/g;
const HEADING = /^#{1,6}\s/;
const SPACE = /\s/;

function isSpace(text: string, index: number): boolean {
    return SPACE.test(text[index]!);
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xD800 && code <= 0xDBFF;
}

function trimSpan(text: string, from: number, to: number): Span | undefined {
    let start = from;
    let end = to;

    while (start < end && isSpace(text, start)) {
        start++;
    }

    while (end > start && isSpace(text, end - 1)) {
        end--;
    }

    return start < end ? { start, end } : undefined;
}

/**
 * Where a chunk prefers to end: the end of every block (text between blank
 * lines), except a Markdown heading block, which belongs to the block after it.
 */
function blockEnds(text: string): number[] {
    const blocks: Span[] = [];
    let from = 0;

    for (const match of text.matchAll(BLOCK_SEPARATOR)) {
        const span = trimSpan(text, from, match.index);

        if (span) {
            blocks.push(span);
        }

        from = match.index + match[0].length;
    }

    const last = trimSpan(text, from, text.length);

    if (last) {
        blocks.push(last);
    }

    const ends: number[] = [];

    for (const [index, block] of blocks.entries()) {
        const heading = HEADING.test(text.slice(block.start, block.start + 7));

        if (!heading || index === blocks.length - 1) {
            ends.push(block.end);
        }
    }

    return ends;
}

function firstNonSpace(text: string, from: number): number {
    let index = from;

    while (index < text.length && isSpace(text, index)) {
        index++;
    }

    return index;
}

/** The first word start (a non-whitespace after whitespace) in `[from, to)`. */
function wordStart(text: string, from: number, to: number): number | undefined {
    for (let index = Math.max(from, 1); index < to; index++) {
        if (!isSpace(text, index) && isSpace(text, index - 1)) {
            return index;
        }
    }

    return undefined;
}

/** The last word end (a whitespace after a non-whitespace) in `(from, to]`. */
function lastWordEnd(text: string, from: number, to: number): number | undefined {
    for (let index = to; index > from; index--) {
        if (isSpace(text, index) && !isSpace(text, index - 1)) {
            return index;
        }
    }

    return undefined;
}

/**
 * The span of the next chunk: its content begins at `next`, and it reaches
 * back to `overlap` (a word start in the chunk before it) when that fits.
 */
function nextSpan(text: string, ends: readonly number[], overlap: number, next: number): Span {
    // greedy: the furthest block end that fits with the whole overlap
    const furthest = ends.findLast((end) => end > next && end - overlap <= CHUNK_MAX_CHARS);

    if (furthest !== undefined) {
        return { start: overlap, end: furthest };
    }

    // the next block fits with less overlap: never split it
    const following = ends.find((end) => end > next)!;

    if (following - next <= CHUNK_MAX_CHARS) {
        return { start: wordStart(text, following - CHUNK_MAX_CHARS, next) ?? next, end: following };
    }

    // a block over the cap: split at the last whitespace before it, else cut
    const start = overlap + CHUNK_MAX_CHARS < next + 2 ? next : overlap;
    const limit = start + CHUNK_MAX_CHARS;
    const end = lastWordEnd(text, next, limit);

    if (end !== undefined) {
        return { start, end };
    }

    return { start, end: isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit };
}

/**
 * Splits a text into passages of at most CHUNK_MAX_CHARS: blocks between
 * blank lines are packed greedily (a Markdown heading stays with the block
 * after it), a block over the cap splits at the last whitespace before it (a
 * hard cut when there is none, never inside a surrogate pair), and every
 * chunk after the first reaches CHUNK_OVERLAP_CHARS back into the one before
 * it, starting at a word. Whitespace-only text gives none.
 */
export function chunkText(text: string): KnowledgeChunk[] {
    const ends = blockEnds(text);

    if (ends.length === 0) {
        return [];
    }

    const textEnd = ends.at(-1)!;
    const chunks: KnowledgeChunk[] = [];
    let previous: Span | undefined;

    while (!previous || previous.end < textEnd) {
        const next = firstNonSpace(text, previous ? previous.end : 0);
        const overlap = previous ?
            wordStart(text, Math.max(previous.start + 1, previous.end - CHUNK_OVERLAP_CHARS), next) ?? next :
            next;
        const span = nextSpan(text, ends, overlap, next);

        chunks.push({
            index: chunks.length,
            text: text.slice(span.start, span.end),
            start: span.start,
            end: span.end,
        });

        previous = span;
    }

    return chunks;
}

/** `sha256:<hex>` of the text's UTF-8 bytes. */
export function contentHash(text: string): string {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
