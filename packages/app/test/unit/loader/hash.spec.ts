/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { hashAgentFolder } from '@chamvi/app';
import { createTempDir, writeTree } from '../../utils/folder.ts';

describe('hashAgentFolder', () => {
    let root: { path: string; remove: () => Promise<void> };

    beforeEach(async () => {
        root = await createTempDir();
    });

    afterEach(async () => {
        await root.remove();
    });

    it('hashAgentFolder is stable across file order and changes with any byte or rename', async () => {
        const one = join(root.path, 'one');
        const two = join(root.path, 'two');
        await writeTree(one, {
            'agent.ts': 'a',
            'tools/x.ts': 'x',
            'prompt.md': 'i',
        });
        await writeTree(two, {
            'tools/x.ts': 'x',
            'prompt.md': 'i',
            'agent.ts': 'a',
        });

        const hash = await hashAgentFolder(one);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(await hashAgentFolder(two)).toBe(hash);

        await writeFile(join(two, 'tools/x.ts'), 'y');
        expect(await hashAgentFolder(two)).not.toBe(hash);
        await writeFile(join(two, 'tools/x.ts'), 'x');
        expect(await hashAgentFolder(two)).toBe(hash);

        await rename(join(two, 'tools/x.ts'), join(two, 'tools/z.ts'));
        expect(await hashAgentFolder(two)).not.toBe(hash);
    });

    it('skips dot entries and hashes path and bytes in POSIX path order', async () => {
        const dir = join(root.path, 'agent');
        await writeTree(dir, {
            'b.md': 'B',
            'a/c.md': 'C',
            '.git/HEAD': 'ignored',
            'tools/.cache': 'ignored',
        });

        const expected = createHash('sha256')
            .update('a/c.md\0C\0')
            .update('b.md\0B\0')
            .digest('hex');

        expect(await hashAgentFolder(dir)).toBe(expected);
    });

    it('skips docs and editor leftovers', async () => {
        const dir = join(root.path, 'agent');
        await writeTree(dir, { 'agent.ts': 'a' });
        const hash = await hashAgentFolder(dir);
        await writeTree(dir, {
            'README.md': 'r',
            'readme.txt': 'r',
            CHANGELOG: 'c',
            'NOTES.md': 'n',
            LICENSE: 'l',
            'agent.ts~': 'b',
            '.agent.ts.swp': 's',
            'x.swo': 's',
            'prompt.md.bak': 'b',
            'agent.ts.orig': 'o',
            'tools/README.md': 'r',
            'tools/.DS_Repository': 'd',
            'Changelog.MD': 'c',
        });
        expect(await hashAgentFolder(dir)).toBe(hash);
    });

    it('still hashes prompts and JSON', async () => {
        const dir = join(root.path, 'agent');
        await writeTree(dir, { 'agent.ts': 'a' });
        const hash = await hashAgentFolder(dir);
        await writeTree(dir, { 'prompt.md': 'p' });
        const withPrompt = await hashAgentFolder(dir);
        expect(withPrompt).not.toBe(hash);
        await writeTree(dir, { 'data.json': '{}' });
        expect(await hashAgentFolder(dir)).not.toBe(withPrompt);
    });

    it('hashes importable files whose names match a doc pattern', async () => {
        const dir = join(root.path, 'agent');
        await writeTree(dir, { 'agent.ts': 'a' });
        const hash = await hashAgentFolder(dir);
        await writeTree(dir, { 'notes.ts': 'export {};' });
        const withNotes = await hashAgentFolder(dir);
        expect(withNotes).not.toBe(hash);
        await writeTree(dir, { 'license.json': '{}' });
        expect(await hashAgentFolder(dir)).not.toBe(withNotes);
    });
});
