/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    INSTRUCTION_DIAGNOSTICS_MAX,
    INSTRUCTION_DIRECTORIES_MAX,
    INSTRUCTION_INCLUDE_DEPTH_MAX,
    INSTRUCTION_PATHS_MAX,
    INSTRUCTION_PATH_MAX_BYTES,
    INSTRUCTION_REFERENCES_MAX,
    INSTRUCTION_SOURCES_MAX,
    INSTRUCTION_SOURCE_MAX_BYTES,
    INSTRUCTION_TOTAL_MAX_BYTES,
    readRepositoryInstructions,
} from '@chamvi/sandbox';
import type { LocalFixture } from '../../utils/instructions.ts';
import { createLocalFixture } from '../../utils/instructions.ts';

const limits = (result: { diagnostics: Array<{ code: string }> }) => result.diagnostics
    .filter((diagnostic) => diagnostic.code === 'limit');

describe('readRepositoryInstructions limits', () => {
    let fixture: LocalFixture;

    beforeEach(async () => {
        fixture = await createLocalFixture();
    });

    afterEach(async () => {
        await fixture.dispose();
    });

    it('exports the limits', () => {
        expect(INSTRUCTION_SOURCE_MAX_BYTES).toBe(32_768);
        expect(INSTRUCTION_TOTAL_MAX_BYTES).toBe(131_072);
        expect(INSTRUCTION_SOURCES_MAX).toBe(32);
        expect(INSTRUCTION_INCLUDE_DEPTH_MAX).toBe(8);
        expect(INSTRUCTION_PATHS_MAX).toBe(32);
        expect(INSTRUCTION_DIRECTORIES_MAX).toBe(64);
        expect(INSTRUCTION_REFERENCES_MAX).toBe(512);
        expect(INSTRUCTION_DIAGNOSTICS_MAX).toBe(64);
        expect(INSTRUCTION_PATH_MAX_BYTES).toBe(4096);
    });

    it('bounds_each_source_and_total_graph: a source at 32 KiB passes, one byte more is omitted', async () => {
        await fixture.write({
            'AGENTS.md': '@fit.md\n@over.md\n',
            'fit.md': 'x'.repeat(32_768),
            'over.md': 'y'.repeat(32_769),
        });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'fit.md']);
        expect(result.sources[1]?.content).toHaveLength(32_768);
        expect(result.diagnostics.map(({ path, code }) => ({ path, code }))).toEqual([{ path: 'over.md', code: 'limit' }]);
        expect(result.complete).toBe(false);
    });

    it('bounds the expanded text at 128 KiB', async () => {
        const entry = '@a.md\n@b.md\n@c.md\n@d.md\n';
        const fill = 32_768;
        const rest = 131_072 - entry.length - 3 * fill;
        await fixture.write({
            'AGENTS.md': entry,
            'a.md': 'a'.repeat(fill),
            'b.md': 'b'.repeat(fill),
            'c.md': 'c'.repeat(fill),
            'd.md': 'd'.repeat(rest),
        });
        const fits = await readRepositoryInstructions(fixture.workspace);
        expect(fits.sources).toHaveLength(5);
        expect(fits.complete).toBe(true);

        await fixture.write({ 'd.md': 'd'.repeat(rest + 1) });
        const over = await readRepositoryInstructions(fixture.workspace);
        expect(over.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'a.md', 'b.md', 'c.md']);
        expect(limits(over)).toHaveLength(1);
        expect(over.complete).toBe(false);
    });

    it('bounds the distinct sources at 32', async () => {
        const includes = Array.from({ length: 31 }, (_, index) => `@s${index}.md`);
        const files: Record<string, string> = { 'AGENTS.md': `${includes.join('\n')}\n` };
        for (let index = 0; index < 32; index++) files[`s${index}.md`] = `${index}\n`;
        await fixture.write(files);

        const fits = await readRepositoryInstructions(fixture.workspace);
        expect(fits.sources).toHaveLength(32);
        expect(fits.complete).toBe(true);

        await fixture.write({ 'AGENTS.md': `${includes.join('\n')}\n@s31.md\n@s31.md\n` });
        const over = await readRepositoryInstructions(fixture.workspace);
        expect(over.sources).toHaveLength(32);
        expect(limits(over)).toHaveLength(1);
        expect(over.complete).toBe(false);
    });

    it('bounds the include depth at 8 edges', async () => {
        const files: Record<string, string> = { 'AGENTS.md': '@d1.md\n' };
        for (let depth = 1; depth <= 8; depth++) files[`d${depth}.md`] = `@d${depth + 1}.md\n`;
        files['d9.md'] = 'end\n';
        await fixture.write(files);

        const result = await readRepositoryInstructions(fixture.workspace);
        // AGENTS.md -> d1 ... d8 is eight edges; d8 -> d9 is the ninth
        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', ...Array.from({ length: 8 }, (_, index) => `d${index + 1}.md`)]);
        expect(result.diagnostics.map(({ path, code }) => ({ path, code }))).toEqual([{ path: 'd9.md', code: 'limit' }]);
    });

    it('bounds the target paths at 32', async () => {
        await fixture.write({ 'AGENTS.md': 'root\n' });
        const paths = Array.from({ length: 32 }, (_, index) => `p${index}.ts`);

        const fits = await readRepositoryInstructions(fixture.workspace, paths);
        expect(fits.paths).toHaveLength(32);
        expect(fits.complete).toBe(true);

        const over = await readRepositoryInstructions(fixture.workspace, [...paths, 'p32.ts']);
        expect(over.paths).toHaveLength(32);
        expect(limits(over)).toHaveLength(1);
        expect(over.sources.map((source) => source.path)).toEqual(['AGENTS.md']);
    });

    it.each([
        ['escaping', '../escape'],
        ['oversized', 'x'.repeat(4097)],
    ])('counts %s targets toward the 32-path budget', async (_name, rejected) => {
        await fixture.write({ 'AGENTS.md': 'root\n' });

        const result = await readRepositoryInstructions(fixture.workspace, [...Array.from({ length: 32 }, () => rejected), '.']);

        expect(result.paths).toEqual([]);
        expect(result.sources).toEqual([]);
        expect(result.diagnostics.some(({
            path,
            code,
            message,
        }) => path === '.' && code === 'limit' && message.includes('32'))).toBe(true);
        expect(result.complete).toBe(false);
    });

    it('bounds the directory levels at 64', async () => {
        const deep = (levels: number) => Array.from({ length: levels }, (_, index) => `d${index}`).join('/');
        await fixture.write({ 'AGENTS.md': 'root\n', [`${deep(63)}/AGENTS.md`]: 'deepest\n' });

        // the root and 63 directories below it
        const fits = await readRepositoryInstructions(fixture.workspace, [`${deep(63)}/x.ts`]);
        expect(fits.sources.map((source) => source.path)).toEqual(['AGENTS.md', `${deep(63)}/AGENTS.md`]);
        expect(fits.complete).toBe(true);

        const over = await readRepositoryInstructions(fixture.workspace, [`${deep(64)}/x.ts`]);
        expect(limits(over)).toHaveLength(1);
        expect(over.complete).toBe(false);
    });

    it('bounds each path at 4096 bytes', async () => {
        const long = `${'a/'.repeat(2047)}b`;
        expect(Buffer.byteLength(long)).toBe(4095);
        const codesFor = async (include: string, paths: string[] = ['.']) => {
            await fixture.write({ 'AGENTS.md': `@${include}\n` });
            const result = await readRepositoryInstructions(fixture.workspace, paths);
            return { paths: result.paths, codes: result.diagnostics.map(({ code }) => code) };
        };

        // one such path nearly fills the diagnostics' 8 KiB, so each request names one
        expect(await codesFor(`${long}c`)).toEqual({ paths: ['.'], codes: ['missing-include'] });
        expect(await codesFor(`${long}cd`)).toEqual({ paths: ['.'], codes: ['limit'] });
        expect(await codesFor('x.md', ['.', `${long}c`])).toEqual({ paths: ['.', `${long}c`], codes: ['limit', 'missing-include'] });
        expect(await codesFor('x.md', ['.', `${long}cd`])).toEqual({ paths: ['.'], codes: ['limit', 'missing-include'] });
    });

    it('bounds a missing-reference storm and the diagnostics', async () => {
        const storm = Array.from({ length: 600 }, (_, index) => `@missing-${index}.md`).join('\n');
        await fixture.write({ 'AGENTS.md': storm });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.diagnostics.length).toBeLessThanOrEqual(64);
        const bytes = result.diagnostics.reduce((sum, { path, message }) => sum + Buffer.byteLength(path) + Buffer.byteLength(message), 0);
        expect(bytes).toBeLessThanOrEqual(8192);
        expect(result.diagnostics.at(-1)?.code).toBe('limit');
        expect(result.complete).toBe(false);
    }, 30_000);
});
