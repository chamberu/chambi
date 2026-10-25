/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { ValidationError } from '@chamvi/core';
import type { GitFixture } from '@chamvi/test-kit';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

type Grep = {
    matches: Array<{
        path: string; 
        line: number; 
        text: string 
    }>;
    truncated: boolean;
    engine: string;
};

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => { fixture = await createFixture(); });
afterAll(async () => { await fixture.cleanup(); });
beforeEach(async () => { s = await setupCoding(fixture); });
afterEach(async () => { await s.cleanup(); });

describe('grep', () => {
    it('finds a line', async () => {
        await expect(s.call('grep', { pattern: 'const b' })).resolves.toMatchObject({
            matches: [{
                path: 'src/a.ts', 
                line: 2, 
                text: 'export const b = 2;', 
            }],
            truncated: false,
        });
    });

    it('ignores case on request', async () => {
        await expect(s.call('grep', { pattern: 'CONST B' })).resolves.toMatchObject({ matches: [], truncated: false });
        const { matches } = await s.call<Grep>('grep', { pattern: 'CONST B', ignoreCase: true });
        expect(matches).toEqual([{
            path: 'src/a.ts', 
            line: 2, 
            text: 'export const b = 2;', 
        }]);
    });

    it('treats a leading dash as a pattern', async () => {
        await expect(s.call('grep', { pattern: '-x' })).resolves.toMatchObject({ matches: [], truncated: false });
    });

    it('refuses an invalid pattern', async () => {
        await expect(s.call('grep', { pattern: '(' })).rejects.toThrow(ValidationError);
        await expect(s.call('grep', { pattern: '' })).rejects.toThrow(ValidationError);
    });

    it('stops at the limit', async () => {
        await expect(s.call('grep', { pattern: 'export', limit: 1 })).resolves.toMatchObject({
            matches: [{
                path: 'src/a.ts', 
                line: 1, 
                text: 'export const a = 1;', 
            }],
            truncated: true,
        });
        await expect(s.call('grep', { pattern: 'export', limit: 0 })).rejects.toThrow(ValidationError);
        await expect(s.call('grep', { pattern: 'export', limit: 501 })).rejects.toThrow(ValidationError);
    });

    it('searches untracked files but not ignored ones', async () => {
        await s.workspace.writeFile('new.ts', 'export const c = 3;\n');
        await s.workspace.writeFile('dist/out.js', 'export const c = 3;\n');
        await expect(s.call('grep', { pattern: 'const c' })).resolves.toMatchObject({
            matches: [{
                path: 'new.ts', 
                line: 1, 
                text: 'export const c = 3;', 
            }],
            truncated: false,
        });
    });

    it('searches below a path and keeps odd file names', async () => {
        await s.workspace.writeFile('we:ird.ts', 'const a = 0;\n');
        await expect(s.call('grep', { pattern: 'const a', path: 'src' })).resolves.toMatchObject({
            matches: [{
                path: 'src/a.ts', 
                line: 1, 
                text: 'export const a = 1;', 
            }],
            truncated: false,
        });
        const { matches } = await s.call<Grep>('grep', { pattern: '^const a' });
        expect(matches).toEqual([{
            path: 'we:ird.ts', 
            line: 1, 
            text: 'const a = 0;', 
        }]);
    });

    it('cuts long lines at LINE_MAX_CHARS', async () => {
        await s.workspace.writeFile('long.txt', `needle${'y'.repeat(1_000)}\n`);
        const { matches } = await s.call<Grep>('grep', { pattern: 'needle' });
        expect(matches).toHaveLength(1);
        expect(matches[0]!.text).toHaveLength(500);
    });

    it('keeps a NUL past the binary check inside the match text', async () => {
        // git -I only inspects the first 8000 bytes; a later NUL must not shift the -z records
        await s.workspace.writeFile('late.txt', `${'x'.repeat(9_000)}\nneedle one\nneedle\0two\nneedle three\n`);
        const { matches } = await s.call<Grep>('grep', { pattern: 'needle', path: 'late.txt' });
        expect(matches).toEqual([
            {
                path: 'late.txt', 
                line: 2, 
                text: 'needle one', 
            },
            {
                path: 'late.txt', 
                line: 3, 
                text: 'needle\0two', 
            },
            {
                path: 'late.txt', 
                line: 4, 
                text: 'needle three', 
            },
        ]);
    });

    it('treats pathspec magic literally', async () => {
        await expect(s.call('grep', { pattern: 'const', path: ':!src' })).resolves.toMatchObject({ matches: [], truncated: false });
        await expect(s.call('list_files', { path: ':(top)src' })).resolves.toEqual({ files: [], truncated: false });
    });
});

describe('grep: engines and ignored files', () => {
    it('names the engine it searched with', async () => {
        // the host PATH of the local provider has no ripgrep in CI or here
        await expect(s.call('grep', { pattern: 'const b' })).resolves.toMatchObject({ engine: 'git-grep' });
    });

    it('searches ignored files on request', async () => {
        await s.workspace.writeFile('dist/out.js', 'export const c = 3;\n');
        await s.workspace.writeFile('.hidden/x.ts', 'export const c = 4;\n');
        await expect(s.call('grep', { pattern: 'const c' })).resolves.toMatchObject({ matches: [{ path: '.hidden/x.ts', line: 1 }] });
        const { matches } = await s.call<Grep>('grep', { pattern: 'const c', includeIgnored: true });
        expect(matches.map((match) => match.path).sort()).toEqual(['.hidden/x.ts', 'dist/out.js']);
    });

    it('searches an output log of bash with grep', async () => {
        const run = await s.call<{ stdoutLog: string }>('bash', { command: 'printf "a\\nneedle 1\\nb\\nneedle 2\\n"' });
        await expect(s.call('grep', { pattern: 'needle', path: run.stdoutLog })).resolves.toEqual({
            matches: [
                {
                    path: run.stdoutLog, 
                    line: 2, 
                    text: 'needle 1', 
                },
                {
                    path: run.stdoutLog, 
                    line: 4, 
                    text: 'needle 2', 
                },
            ],
            truncated: false,
            engine: 'grep',
        });
    });
});

describe('list_files: ignored files', () => {
    it('lists ignored files on request', async () => {
        await s.workspace.writeFile('dist/out.js', 'x\n');
        await expect(s.call<{ files: string[] }>('list_files', {})).resolves.toMatchObject({ files: expect.not.arrayContaining(['dist/out.js']) });
        await expect(s.call<{ files: string[] }>('list_files', { includeIgnored: true })).resolves.toMatchObject({ files: expect.arrayContaining(['dist/out.js', 'src/a.ts']) });
    });
});

describe('glob', () => {
    it('matches a pattern with ** across directories', async () => {
        await s.workspace.writeFile('src/deep/b.ts', 'x\n');
        await expect(s.call('glob', { pattern: '**/*.ts' })).resolves.toEqual({
            files: ['src/a.ts', 'src/deep/b.ts'],
            truncated: false,
        });
        await expect(s.call('glob', { pattern: '*.json' })).resolves.toEqual({ files: ['package.json'], truncated: false });
    });

    it('matches below a path, up to a limit, ignored files on request', async () => {
        await s.workspace.writeFile('src/deep/b.ts', 'x\n');
        await s.workspace.writeFile('dist/c.ts', 'x\n');
        await expect(s.call('glob', { pattern: '*.ts', path: 'src' })).resolves.toEqual({ files: ['src/a.ts'], truncated: false });
        await expect(s.call('glob', { pattern: '**/*.ts', limit: 1 })).resolves.toEqual({ files: ['src/a.ts'], truncated: true });
        await expect(s.call('glob', { pattern: 'dist/*.ts' })).resolves.toEqual({ files: [], truncated: false });
        await expect(s.call('glob', { pattern: 'dist/*.ts', includeIgnored: true })).resolves.toEqual({ files: ['dist/c.ts'], truncated: false });
    });

    it('refuses patterns that leave the path', async () => {
        await expect(s.call('glob', { pattern: '/etc/*' })).rejects.toThrow(ValidationError);
        await expect(s.call('glob', { pattern: '../*' })).rejects.toThrow(ValidationError);
        await expect(s.call('glob', { pattern: '' })).rejects.toThrow(ValidationError);
    });
});
