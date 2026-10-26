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

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => { fixture = await createFixture(); });
afterAll(async () => { await fixture.cleanup(); });
beforeEach(async () => { s = await setupCoding(fixture); });
afterEach(async () => { await s.cleanup(); });

describe('edit_file', () => {
    it('replaces one match', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 3',
        })).resolves.toEqual({ path: 'src/a.ts', replacements: 1 });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = 3;\nexport const b = 2;\n');
    });

    it('applies every edit of one file the model sends in one step', async () => {
        await s.call('write_file', { path: 'src/c.ts', content: 'a = 1;\nb = 2;\nc = 3;\n' });
        const results = await Promise.all([
            ['a = 1', 'a = 10'],
            ['b = 2', 'b = 20'],
            ['c = 3', 'c = 30'],
        ].map(([oldString, newString]) => s.call('edit_file', {
            path: 'src/c.ts',
            oldString,
            newString,
        })));
        expect(results).toEqual(Array.from({ length: 3 }, () => ({ path: 'src/c.ts', replacements: 1 })));
        await expect(s.workspace.readFile('src/c.ts')).resolves.toBe('a = 10;\nb = 20;\nc = 30;\n');

        // a write and an edit of one file run one after the other too
        await Promise.all([
            s.call('write_file', { path: '/workspace/src/c.ts', content: 'x = 1;\n' }),
            s.call('edit_file', {
                path: 'src/c.ts',
                oldString: 'x = 1',
                newString: 'x = 2',
            }),
        ]);
        await expect(s.workspace.readFile('src/c.ts')).resolves.toBe('x = 2;\n');
    });

    it('inserts replacement patterns literally', async () => {
        await s.call('edit_file', {
            path: 'src/a.ts',
            oldString: '1',
            newString: '$&$1$$',
        });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = $&$1$$;\nexport const b = 2;\n');
    });

    it('refuses a missing oldString', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'nope',
            newString: 'x',
        })).rejects.toThrow(/not found/);
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'nope',
            newString: 'x',
        })).rejects.toThrow(ValidationError);
    });

    it('refuses several matches without replaceAll', async () => {
        const edit = s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'export',
            newString: 'export declare',
        });
        await expect(edit).rejects.toThrow(ValidationError);
        await expect(edit).rejects.toThrow(/2 matches/);
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = 1;\nexport const b = 2;\n');
    });

    it('replaces every match with replaceAll', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'export ',
            newString: '',
            replaceAll: true,
        })).resolves.toEqual({ path: 'src/a.ts', replacements: 2 });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('const a = 1;\nconst b = 2;\n');
    });

    it('refuses an empty or unchanged oldString', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: '',
            newString: 'x',
        })).rejects.toThrow(ValidationError);
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 1',
        })).rejects.toThrow(ValidationError);
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 2',
            replaceAll: 'yes',
        })).rejects.toThrow(ValidationError);
    });
});

describe('multi_edit', () => {
    it('applies the edits in order and writes once', async () => {
        await expect(s.call('multi_edit', {
            path: 'src/a.ts',
            edits: [
                { oldString: 'a = 1', newString: 'a = 10' },
                { oldString: 'a = 10', newString: 'a = 100' },
                {
                    oldString: 'export', 
                    newString: 'export /* x */', 
                    replaceAll: true, 
                },
            ],
        })).resolves.toEqual({
            path: 'src/a.ts', 
            edits: 3, 
            replacements: 4, 
        });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export /* x */ const a = 100;\nexport /* x */ const b = 2;\n');
    });

    it('writes nothing when one edit does not match', async () => {
        const error = await s.call('multi_edit', {
            path: 'src/a.ts',
            edits: [
                { oldString: 'a = 1', newString: 'a = 10' },
                { oldString: 'missing', newString: 'x' },
            ],
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toContain('edit 2');
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = 1;\nexport const b = 2;\n');
    });

    it('refuses ambiguous edits and bad input', async () => {
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: [{ oldString: 'export', newString: 'x' }] }))
            .rejects.toThrow(/edit 1.*2 matches/);
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: [] })).rejects.toThrow(ValidationError);
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: [{ oldString: 'a', newString: 'a' }] })).rejects.toThrow(ValidationError);
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: 'x' })).rejects.toThrow(ValidationError);
        await expect(s.call('multi_edit', { path: '../a.ts', edits: [{ oldString: 'a', newString: 'b' }] })).rejects.toThrow(ValidationError);
    });
});
