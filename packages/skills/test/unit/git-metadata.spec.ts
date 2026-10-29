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
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import { prepareSkills } from '@chamvi/skills';
import { discoverSkills } from 'skills';
import type * as SkillsSDK from 'skills';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('skills', async (importOriginal) => {
    const sdk = await importOriginal<typeof SkillsSDK>();
    return { ...sdk, discoverSkills: vi.fn(sdk.discoverSkills) };
});

const roots: string[] = [];
const fixtures: GitFixture[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    fixtures.length = 0;
    roots.length = 0;
});

async function setup(command: string, mode: string) {
    const fixture = await createGitFixture({ 'skills/audit/SKILL.md': '---\nname: audit\ndescription: Review\n---\nBODY\n' });
    fixtures.push(fixture);
    const root = await fs.mkdtemp(join(tmpdir(), 'chamvi-metadata-test-'));
    roots.push(root);
    const options = {
        source: fixture.path,
        revision: fixture.commit,
        names: ['audit'],
        directory: join(root, 'corpus'),
    };
    await prepareSkills(options);
    const binary = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const bin = join(root, 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(join(bin, 'git'), `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === ${JSON.stringify(command)}) {
    const head = spawnSync(${JSON.stringify(binary)}, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'started'))}, JSON.stringify({ command: args[0], cwd: process.cwd(), head }));
    const mode = ${JSON.stringify(mode)};
    if (mode === 'slow') {
        setInterval(() => process.stdout.write(' '), 10);
    } else if (mode === 'stdout') {
        process.stdout.write(${JSON.stringify(command)} === 'rev-parse' ? ${JSON.stringify(fixture.commit)} + ' '.repeat(1048577) : Buffer.alloc(1048577));
    } else {
        if (${JSON.stringify(command)} === 'rev-parse') process.stdout.write(${JSON.stringify(fixture.commit)} + String.fromCharCode(10));
        process.stderr.write(Buffer.alloc(1048577, 'x'));
    }
} else {
    const result = spawnSync(${JSON.stringify(binary)}, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
`, { mode: 0o755 });
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    vi.mocked(discoverSkills).mockClear();
    return { root, options };
}

it.each([
    ['rev-parse', 'stdout'],
    ['rev-parse', 'stderr'],
    ['ls-tree', 'stdout'],
    ['ls-tree', 'stderr'],
])('fails closed on oversized %s %s before discovery and preserves output and cleanup', async (command, stream) => {
    const { root, options } = await setup(command, stream);
    await expect(prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    expect(discoverSkills).not.toHaveBeenCalled();
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('BODY');
    const started = JSON.parse(await fs.readFile(join(root, 'started'), 'utf8'));
    expect(started).toMatchObject({ command, head: options.revision });
    expect(started.cwd).not.toBe(await fs.realpath(options.source));
    await expect(fs.stat(started.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'started']);
});

it.each(['rev-parse', 'ls-tree'])('enforces the absolute 30 second deadline for %s despite output', async (command) => {
    const { root, options } = await setup(command, 'slow');
    const { setTimeout } = globalThis;
    // Compress only the production deadline; the child still runs and emits real output.
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => (
        setTimeout(callback, delay === 30_000 ? 1_000 : delay, ...args)
    ));
    await expect(prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    expect(timers.mock.calls.some(([, delay]) => delay === 30_000)).toBe(true);
    expect(discoverSkills).not.toHaveBeenCalled();
    const started = JSON.parse(await fs.readFile(join(root, 'started'), 'utf8'));
    expect(started).toMatchObject({ command, head: options.revision });
    expect(started.cwd).not.toBe(await fs.realpath(options.source));
    await expect(fs.stat(started.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'started']);
}, 10_000);
