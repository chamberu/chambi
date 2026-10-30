/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { readRepositoryInstructions } from '@chamvi/sandbox';
import type { DockerFixture } from '../../utils/instructions.ts';
import { createDockerFixture, hasDockerImage } from '../../utils/instructions.ts';

/**
 * The discovery script over a remote workspace (exec script, GNU or BusyBox
 * `timeout`) in a Linux container: images other suites build, skipped when
 * neither Docker nor the image is there.
 */
const IMAGES = (process.env.CHAMVI_INSTRUCTIONS_IMAGES ?? 'chamvi/sandbox-dev:test,alpine:3')
    .split(',')
    .filter(Boolean);

const available = await Promise.all(IMAGES.map(async (image) => [image, await hasDockerImage(image)] as const));

const codes = (result: { diagnostics: Array<{ path: string; code: string }> }) => result.diagnostics
    .map(({ path, code }) => ({ path, code }));

for (const [image, present] of available) {
    describe.skipIf(!present)(`readRepositoryInstructions over a remote workspace (${image})`, () => {
        let fixture: DockerFixture;

        beforeAll(async () => {
            fixture = await createDockerFixture(image, '1000:1000');
            await fixture.write({
                'AGENTS.md': [
                    '@guide.md',
                    '@linked-file.md',
                    '@linked-dir/AGENTS.md',
                    '@alias.md',
                    '@fifo.md',
                    '@locked.md',
                    '@missing.md',
                    '@../escape.md',
                    '@.git/config',
                    '```',
                    '@fenced.md',
                    '```',
                    '$(touch sentinel)',
                ].join('\n'),
                'CLAUDE.md': '@AGENTS.md\n',
                'guide.md': 'token ghs_remoteSECRET\n',
                'locked.md': 'locked\n',
                'packages/api/AGENTS.md': 'api\n',
                'packages/web/AGENTS.md': 'web\n',
                'closed/AGENTS.md': 'closed\n',
                '.git/config': '[core]\n',
            });
            await fixture.sh([
                'ln -s /etc/passwd linked-file.md',
                'ln -s /etc linked-dir',
                'ln -s guide.md alias.md',
                'ln -s /etc escape',
                'mkfifo fifo.md',
                'chmod 000 locked.md closed',
            ].join(' && '));
        }, 60_000);

        afterAll(async () => {
            await fixture?.dispose();
        });

        it('collects, refuses links and special files and tells denial from absence', async () => {
            const workspace = Object.assign(Object.create(fixture.workspace) as typeof fixture.workspace, { redact: (text: string) => text.split('ghs_remoteSECRET').join('[redacted]') });

            workspace.exec = fixture.workspace.exec.bind(fixture.workspace);

            const result = await readRepositoryInstructions(workspace, ['packages/api/src/a.ts', 'escape/x', 'closed/y.ts']);

            expect(result.sources.map((source) => source.path)).toEqual([
                'AGENTS.md',
                'guide.md',
                'CLAUDE.md',
                'packages/api/AGENTS.md',
            ]);

            const guide = result.sources[1];

            expect(guide?.content).toBe('token [redacted]\n');
            expect(guide?.sha256).toBe(createHash('sha256').update('token ghs_remoteSECRET\n').digest('hex'));
            expect(result.sources[0]?.includedBy).toEqual(['CLAUDE.md']);
            expect(codes(result)).toEqual([
                { path: 'escape', code: 'unsupported-file' },
                { path: 'closed', code: 'unreadable' },
                { path: 'linked-file.md', code: 'unsupported-file' },
                { path: 'linked-dir', code: 'unsupported-file' },
                { path: 'alias.md', code: 'unsupported-file' },
                { path: 'fifo.md', code: 'unsupported-file' },
                { path: 'locked.md', code: 'unreadable' },
                { path: 'missing.md', code: 'missing-include' },
                { path: '../escape.md', code: 'outside-workspace' },
                { path: '.git/config', code: 'unsupported-file' },
            ]);
            expect(JSON.stringify(result)).not.toContain('root:');

            const listing = await fixture.workspace.exec(['ls', '-a']);

            expect(listing.stdout).not.toContain('sentinel');
        }, 60_000);
    });
}
