/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createOutputCollector } from '@chamvi/sandbox';

const encoder = new TextEncoder();

describe('createOutputCollector', () => {
    it('keeps everything under the cap', () => {
        const collector = createOutputCollector(16);

        collector.write(encoder.encode('0123456789'));
        expect(collector.text()).toBe('0123456789');
        expect(collector.bytes()).toHaveLength(10);
        expect(collector.truncated).toBe(false);
    });

    it('caps at maxBytes and keeps counting', () => {
        const collector = createOutputCollector(100);

        for (let i = 0; i < 3; i++) {
            collector.write(new Uint8Array(40).fill(0x61 + i));
        }

        expect(collector.bytes()).toHaveLength(100);
        expect(collector.truncated).toBe(true);
        expect(collector.text()).toBe('a'.repeat(40) + 'b'.repeat(40) + 'c'.repeat(20));
    });

    it('is not truncated at exactly the cap', () => {
        const collector = createOutputCollector(10);

        collector.write(encoder.encode('0123456789'));
        expect(collector.truncated).toBe(false);
        collector.write(new Uint8Array(0));
        expect(collector.truncated).toBe(false);
        collector.write(encoder.encode('x'));
        expect(collector.truncated).toBe(true);
        expect(collector.text()).toBe('0123456789');
    });

    it('drops a multi-byte character cut by the cap', () => {
        const collector = createOutputCollector(100);

        collector.write(encoder.encode(`${'a'.repeat(99)}€`));
        expect(collector.truncated).toBe(true);
        expect(collector.text()).toBe('a'.repeat(99));
    });

    it('drops a four-byte character cut anywhere by the cap', () => {
        for (const cut of [1, 2, 3]) {
            const collector = createOutputCollector(2 + cut);

            collector.write(encoder.encode('ab😀'));
            expect(collector.text()).toBe('ab');
        }
    });

    it('keeps multi-byte characters split across chunks', () => {
        const collector = createOutputCollector(100);
        const bytes = encoder.encode('x€y');

        collector.write(bytes.subarray(0, 2));
        collector.write(bytes.subarray(2));
        expect(collector.text()).toBe('x€y');
    });

    it('holds at most the cap', () => {
        const collector = createOutputCollector(65_536);
        const chunk = new Uint8Array(65_536).fill(0x61);

        for (let written = 0; written < 10 * 1024 * 1024; written += chunk.length) {
            collector.write(chunk);
        }

        expect(collector.bytes()).toHaveLength(65_536);
        expect(collector.truncated).toBe(true);
    });

    it('copies the chunk instead of keeping a reference', () => {
        const collector = createOutputCollector(16);
        const chunk = encoder.encode('abc');

        collector.write(chunk);
        chunk.fill(0x7a);
        expect(collector.text()).toBe('abc');
    });

    it('copies a Buffer chunk, whose slice is a view', () => {
        const collector = createOutputCollector(16);
        const chunk = Buffer.from('abc');

        collector.write(chunk);
        chunk.fill(0x7a);
        expect(collector.text()).toBe('abc');
    });

    it('copies a Buffer chunk cut by the cap', () => {
        const collector = createOutputCollector(2);
        const chunk = Buffer.from('abc');

        collector.write(chunk);
        chunk.fill(0x7a);
        expect(collector.text()).toBe('ab');
    });
});
