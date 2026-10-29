/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@chamvi/core';
import { createGitFixture } from '@chamvi/test-kit';

describe('createGitFixture', () => {
    it('refuses file names that leave the repository', async () => {
        const outside = `chamvi-git-fixture-escape-${process.pid}`;
        await expect(createGitFixture({ [`../${outside}`]: 'x' })).rejects.toBeInstanceOf(ValidationError);
        await expect(createGitFixture({ [join(tmpdir(), outside)]: 'x' })).rejects.toBeInstanceOf(ValidationError);
        await expect(createGitFixture({ '': 'x' })).rejects.toBeInstanceOf(ValidationError);
        expect(existsSync(join(tmpdir(), outside))).toBe(false);
    });

    it('writes nested files and cleans up', async () => {
        const fixture = await createGitFixture({ 'src/a.txt': 'a' });
        expect(existsSync(join(fixture.path, 'src/a.txt'))).toBe(true);
        await fixture.cleanup();
        expect(existsSync(fixture.path)).toBe(false);
    });

    it('preserves raw NULs and newlines, and recovers after a failed command', async () => {
        const fixture = await createGitFixture({ 'a.txt': 'a\n\n', 'nested/b.txt': 'b' });
        try {
            await expect(fixture.git('show', 'HEAD:a.txt')).resolves.toBe('a\n\n');
            await expect(fixture.git('ls-tree', '-r', '-z', '--name-only', 'HEAD')).resolves.toBe('a.txt\0nested/b.txt\0');
            await expect(fixture.git('rev-parse', '--verify', 'missing')).rejects.toThrow();
            await expect(fixture.git('rev-parse', 'HEAD')).resolves.toBe(`${fixture.commit}\n`);
        } finally {
            await fixture.cleanup();
        }
    });

    it('accepts explicit trusted Git configuration in raw commands', async () => {
        const fixture = await createGitFixture({ 'a.txt': 'a' });
        try {
            await expect(fixture.git('-c', 'alias.fixture-raw=!printf "trusted\\n"', 'fixture-raw')).resolves.toBe('trusted\n');
            await expect(fixture.git('status', '--porc')).resolves.toBe('');
            const config = join(fixture.path, 'fixture.config');
            await writeFile(config, '[fixture]\nvalue = included\n');
            await expect(fixture.git('-c', `include.path=${config}`, 'config', 'fixture.value')).resolves.toBe('included\n');
        } finally {
            await fixture.cleanup();
        }
    });

    it('runs git in the repository with the fixture identity', async () => {
        const fixture = await createGitFixture({ 'a.txt': 'a' });
        try {
            await fixture.git('switch', '-q', '-c', 'feature');
            await fixture.git('commit', '-q', '--allow-empty', '-m', 'second');
            const log = await fixture.git('log', '--format=%an %s', 'feature');
            expect(log).toBe('chamvi second\nchamvi fixture\n');
            await expect(fixture.git('rev-parse', 'main')).resolves.toBe(`${fixture.commit}\n`);
        } finally {
            await fixture.cleanup();
        }
    });
});
