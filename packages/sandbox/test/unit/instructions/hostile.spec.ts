/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    chmod,
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { readRepositoryInstructions } from '@chamvi/sandbox';
import type { LocalFixture } from '../../utils/instructions.ts';
import { createLocalFixture, run } from '../../utils/instructions.ts';

const codes = (result: { diagnostics: Array<{ path: string; code: string }> }) => result.diagnostics
    .map(({ path, code }) => ({ path, code }));

describe('readRepositoryInstructions (hostile input, local workspace)', () => {
    let fixture: LocalFixture;
    let outside: string;

    beforeEach(async () => {
        fixture = await createLocalFixture();
        outside = await mkdtemp(join(tmpdir(), 'chamvi-outside-'));
        await writeFile(join(outside, 'secret.md'), 'outside secret\n');
        await mkdir(join(outside, 'dir'));
        await writeFile(join(outside, 'dir', 'AGENTS.md'), 'outside agents\n');
    });

    afterEach(async () => {
        await fixture.dispose();
        await rm(outside, { recursive: true, force: true });
    });

    it('rejects_symlink_escape_and_special_files', async () => {
        await fixture.write({
            'AGENTS.md': [
                '@linked-file.md',
                '@linked-dir/AGENTS.md',
                '@alias.md',
                '@/etc/passwd',
                '@https://example.com/x.md',
                '@../outside.md',
                '@sub/../../outside.md',
                '@.git/config',
                '@.GIT/HEAD',
                '@fifo.md',
                '@plain-dir',
                '@inside.md',
            ].join('\n'),
            'inside.md': 'inside\n',
            '.git/config': '[core]\n',
        });
        await symlink(join(outside, 'secret.md'), join(fixture.dir, 'linked-file.md'));
        await symlink(join(outside, 'dir'), join(fixture.dir, 'linked-dir'));
        await symlink('inside.md', join(fixture.dir, 'alias.md'));
        await mkdir(join(fixture.dir, 'plain-dir'));
        expect((await run('mkfifo', [join(fixture.dir, 'fifo.md')])).code).toBe(0);

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'inside.md']);
        expect(JSON.stringify(result)).not.toMatch(/outside (secret|agents)/);
        expect(codes(result)).toEqual([
            { path: 'linked-file.md', code: 'unsupported-file' },
            { path: 'linked-dir', code: 'unsupported-file' },
            { path: 'alias.md', code: 'unsupported-file' },
            { path: '/etc/passwd', code: 'outside-workspace' },
            { path: 'https://example.com/x.md', code: 'outside-workspace' },
            { path: '../outside.md', code: 'outside-workspace' },
            { path: 'sub/../../outside.md', code: 'outside-workspace' },
            { path: '.git/config', code: 'unsupported-file' },
            { path: '.GIT/HEAD', code: 'unsupported-file' },
            { path: 'fifo.md', code: 'unsupported-file' },
            { path: 'plain-dir', code: 'unsupported-file' },
        ]);
        expect(result.complete).toBe(false);
    });

    it('refuses symlinked and special entrypoints and target directories', async () => {
        await fixture.write({ 'inside.md': 'inside\n', 'real/AGENTS.md': 'real\n' });
        await symlink('inside.md', join(fixture.dir, 'AGENTS.md'));
        expect((await run('mkfifo', [join(fixture.dir, 'CLAUDE.md')])).code).toBe(0);
        await symlink(join(outside, 'dir'), join(fixture.dir, 'escape'));
        await symlink('real', join(fixture.dir, 'alias'));

        const result = await readRepositoryInstructions(fixture.workspace, ['escape/x.ts', 'alias/y.ts', '.git/hooks']);

        expect(result.sources).toEqual([]);
        expect(codes(result)).toEqual([
            { path: 'escape', code: 'unsupported-file' },
            { path: 'alias', code: 'unsupported-file' },
            { path: '.git/hooks', code: 'unsupported-file' },
            { path: 'AGENTS.md', code: 'unsupported-file' },
            { path: 'CLAUDE.md', code: 'unsupported-file' },
        ]);
        expect(result.paths).toEqual(['escape/x.ts', 'alias/y.ts', '.git/hooks']);
        expect(result.complete).toBe(false);
    });

    it('reports a target escaping the workspace as a diagnostic', async () => {
        await fixture.write({ 'AGENTS.md': 'root\n' });

        const result = await readRepositoryInstructions(fixture.workspace, ['../x', '/etc']);

        expect(codes(result)).toEqual([
            { path: '../x', code: 'outside-workspace' },
            { path: '/etc', code: 'outside-workspace' },
        ]);
        expect(result.sources).toEqual([]);
    });

    it.skipIf(process.getuid?.() === 0)('distinguishes read denial from absence', async () => {
        await fixture.write({
            'AGENTS.md': '@locked.md\n@absent.md\n',
            'locked.md': 'locked\n',
            'closed/AGENTS.md': 'closed\n',
        });
        await chmod(join(fixture.dir, 'locked.md'), 0o000);
        await chmod(join(fixture.dir, 'closed'), 0o000);

        try {
            const result = await readRepositoryInstructions(fixture.workspace, ['closed/x.ts']);

            expect(codes(result)).toEqual([
                { path: 'closed', code: 'unreadable' },
                { path: 'locked.md', code: 'unreadable' },
                { path: 'absent.md', code: 'missing-include' },
            ]);
        } finally {
            await chmod(join(fixture.dir, 'closed'), 0o755);
            await chmod(join(fixture.dir, 'locked.md'), 0o644);
        }
    });

    it('handles newline and long filenames as data', async () => {
        await fixture.write({ 'odd\nname/AGENTS.md': 'odd\n', 'AGENTS.md': `@${'a'.repeat(300)}.md\n` });

        const result = await readRepositoryInstructions(fixture.workspace, ['odd\nname/x.ts', `${'b'.repeat(300)}/x.ts`]);

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'odd\nname/AGENTS.md']);
        expect(codes(result)).toEqual([{ path: `${'a'.repeat(300)}.md`, code: 'missing-include' }]);
    });
});
