/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitFixture } from '@chamvi/test-kit';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';

const roots: string[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    roots.length = 0;
});

async function fixtureWithProcess() {
    const binary = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const root = await fs.mkdtemp(join(tmpdir(), 'chamvi-git-process-'));

    roots.push(root);
    await fs.writeFile(join(root, 'git'), `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const command = process.argv[2];
if (command === 'fixture-env') {
    process.stdout.write(JSON.stringify(process.env));
} else if (command === 'fixture-boundary') {
    process.stdout.write(Buffer.alloc(1048576, 'a'));
    process.stderr.write(Buffer.alloc(1048576, 'b'));
} else if (command === 'fixture-signal') {
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid));
    setTimeout(() => process.exit(0), 3000);
} else if (command === 'fixture-resistant-stdout' || command === 'fixture-resistant-stderr') {
    const fs = require('node:fs');
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {
        fs.writeFileSync(${JSON.stringify(join(root, 'terminated'))}, 'SIGTERM');
        process.removeAllListeners('SIGTERM');
        process.kill(process.pid, 'SIGTERM');
    });
    process.stdout.on('error', () => {});
    process.stderr.on('error', () => {});
    const stream = command.endsWith('stdout') ? process.stdout : process.stderr;
    let chunks = 0;
    const timer = setInterval(() => {
        stream.write(Buffer.alloc(262144, 'x'));
        if (++chunks === 16) {
            clearInterval(timer);
            fs.writeFileSync(${JSON.stringify(join(root, 'completed'))}, 'unbounded');
        }
    }, 10);
} else if (command === 'fixture-stdout' || command === 'fixture-stderr') {
    const stream = command === 'fixture-stdout' ? process.stdout : process.stderr;
    stream.write(Buffer.alloc(1048577, 'x'));
} else {
    const result = spawnSync(${JSON.stringify(binary)}, process.argv.slice(2), { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
`, { mode: 0o755 });
    vi.stubEnv('PATH', `${root}:${process.env.PATH}`);
    vi.stubEnv('CHAMVI_FIXTURE_SECRET', 'must-not-inherit');
    vi.stubEnv('GIT_DIR', '/missing-parent-repo');
    vi.stubEnv('GIT_AUTHOR_NAME', 'parent');
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'commit.gpgsign');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true');

    return { fixture: await createGitFixture({ 'a.txt': 'a' }), root };
}

it('replaces inherited environment and keeps the fixture config, identity and cwd', async () => {
    const { fixture } = await fixtureWithProcess();
    const cwd = process.cwd();

    try {
        const env = JSON.parse(await fixture.git('fixture-env'));

        expect(env).toMatchObject({
            HOME: fixture.path,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
            GIT_AUTHOR_NAME: 'chamvi',
            GIT_AUTHOR_EMAIL: 'fixture@chamvi.dev',
            GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
            GIT_COMMITTER_NAME: 'chamvi',
            GIT_COMMITTER_EMAIL: 'fixture@chamvi.dev',
            GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'commit.gpgsign',
            GIT_CONFIG_VALUE_0: 'false',
            GIT_CONFIG_KEY_1: 'tag.gpgsign',
            GIT_CONFIG_VALUE_1: 'false',
        });
        expect(env).not.toHaveProperty('CHAMVI_FIXTURE_SECRET');
        expect(env).not.toHaveProperty('GIT_DIR');
        await expect(fixture.git('config', 'commit.gpgsign')).resolves.toBe('false\n');
        await expect(fixture.git('config', 'tag.gpgsign')).resolves.toBe('false\n');
        await expect(fixture.git('rev-parse', '--show-toplevel')).resolves.toBe(`${await fs.realpath(fixture.path)}\n`);
        await expect(fixture.git('show', '-s', '--format=%an <%ae> %at %cn <%ce> %ct', 'HEAD')).resolves.toBe(
            'chamvi <fixture@chamvi.dev> 1767225600 chamvi <fixture@chamvi.dev> 1767225600\n',
        );
        expect(process.cwd()).toBe(cwd);
        expect(process.env.GIT_AUTHOR_NAME).toBe('parent');
    } finally {
        await fixture.cleanup();
    }
});

it('accepts the full output allowance independently for each stream and command', async () => {
    const { fixture } = await fixtureWithProcess();

    try {
        for (let index = 0; index < 2; index++) {
            await expect(fixture.git('fixture-boundary')).resolves.toBe('a'.repeat(1_048_576));
        }
    } finally {
        await fixture.cleanup();
    }
});

it.each(['stdout', 'stderr'])('rejects %s above 1 MiB and leaves later commands usable', async (stream) => {
    const { fixture } = await fixtureWithProcess();

    try {
        await expect(fixture.git(`fixture-${stream}`)).rejects.toThrow();
        await expect(fixture.git('rev-parse', 'HEAD')).resolves.toBe(`${fixture.commit}\n`);
    } finally {
        await fixture.cleanup();
    }
});

it('rejects a real Git command with a silent nonzero exit and permits later calls', async () => {
    const fixture = await createGitFixture({ 'a.txt': 'a' });

    try {
        await fs.writeFile(join(fixture.path, 'a.txt'), 'changed');
        await expect(fixture.git('diff', '--quiet')).rejects.toMatchObject({ code: 1, stderr: '' });
        await expect(fixture.git('rev-parse', 'HEAD')).resolves.toBe(`${fixture.commit}\n`);
    } finally {
        await fixture.cleanup();
    }
});

it('rejects external SIGTERM without stderr and permits later calls', async () => {
    const { fixture, root } = await fixtureWithProcess();

    try {
        const rejected = expect(fixture.git('fixture-signal')).rejects.toMatchObject({ signal: 'SIGTERM', stderr: '' });

        await vi.waitFor(() => expect(fs.readFile(join(root, 'pid'), 'utf8')).resolves.toMatch(/^\d+$/u));
        process.kill(Number(await fs.readFile(join(root, 'pid'), 'utf8')), 'SIGTERM');
        await rejected;
        await expect(fixture.git('rev-parse', 'HEAD')).resolves.toBe(`${fixture.commit}\n`);
    } finally {
        await fixture.cleanup();
    }
});

it.each(['stdout', 'stderr'])('terminates a SIGINT-resistant %s flood at the output bound', async (stream) => {
    const { fixture, root } = await fixtureWithProcess();

    try {
        await expect(fixture.git(`fixture-resistant-${stream}`)).rejects.toThrow();
        expect(await fs.readFile(join(root, 'terminated'), 'utf8')).toBe('SIGTERM');
        await expect(fs.stat(join(root, 'completed'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fixture.git('rev-parse', 'HEAD')).resolves.toBe(`${fixture.commit}\n`);
    } finally {
        await fixture.cleanup();
    }
});
