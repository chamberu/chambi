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
import type { GitFixture } from '@chamvi/test-kit';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

type Diff = {
    status: string;
    diff: string;
    truncated: boolean
};

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => {
    fixture = await createFixture();
});
afterAll(async () => {
    await fixture.cleanup();
});
beforeEach(async () => {
    s = await setupCoding(fixture);
});
afterEach(async () => {
    await s.cleanup();
});

describe('git_diff', () => {
    it('is empty for a clean checkout', async () => {
        await expect(s.call('git_diff', {})).resolves.toEqual({
            status: '',
            diff: '',
            truncated: false,
        });
    });

    it('shows an edit and untracked files', async () => {
        await s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 3',
        });
        await s.call('write_file', { path: 'new.ts', content: 'export {};\n' });

        const {
            status,
            diff,
            truncated,
        } = await s.call<Diff>('git_diff', {});

        expect(diff).toContain('-export const a = 1;');
        expect(diff).toContain('+export const a = 3;');
        expect(status).toContain(' M src/a.ts');
        expect(status).toContain('?? new.ts');
        expect(truncated).toBe(false);
    });

    it('shows staged changes and limits to a path', async () => {
        await s.call('write_file', { path: 'new.ts', content: 'export {};\n' });
        await s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'b = 2',
            newString: 'b = 4',
        });
        await s.call('bash', { command: 'git add new.ts' });

        const staged = await s.call<Diff>('git_diff', { staged: true });

        expect(staged.diff).toContain('+++ b/new.ts');
        expect(staged.diff).not.toContain('src/a.ts');

        const scoped = await s.call<Diff>('git_diff', { path: 'src' });

        expect(scoped.diff).toContain('+export const b = 4;');
        expect(scoped.status).toBe(' M src/a.ts\n');
    });
});
