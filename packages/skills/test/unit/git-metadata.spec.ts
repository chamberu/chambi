/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFileSync } from 'node:child_process';
import type { ExecFileOptions } from 'node:child_process';
import type * as ChildProcess from 'node:child_process';
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

const deadlines = vi.hoisted(() => [] as number[]);

vi.mock('node:child_process', async (importOriginal) => {
    const childProcess = await importOriginal<typeof ChildProcess>();
    const { promisify } = await import('node:util');
    const run = promisify(childProcess.execFile);
    // Delegate to real execFile, compressing only the production metadata deadline.
    const execFile = Object.defineProperty(childProcess.execFile.bind(null), promisify.custom, {
        value: (file: string, args: string[], options: ExecFileOptions) => {
            if (options.timeout === 30_000) {
                deadlines.push(options.timeout);
                return run(file, args, { ...options, timeout: 1_000 });
            }
            return run(file, args, options);
        },
    });
    return { ...childProcess, execFile };
});

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
    deadlines.length = 0;
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
const directory = args[0] === '-C' ? args[1] : process.cwd();
const command = args[0] === '-C' ? args[2] : args[0];
if (command === ${JSON.stringify(command)}) {
    const fs = require('node:fs');
    const head = spawnSync(${JSON.stringify(binary)}, ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(${JSON.stringify(join(root, 'started'))}, JSON.stringify({ command, directory, cwd: process.cwd(), head }));
    const mode = ${JSON.stringify(mode)};
    if (mode === 'slow' || mode.startsWith('resistant-')) {
        process.on('SIGINT', () => {});
        process.on('SIGTERM', () => {
            fs.writeFileSync(${JSON.stringify(join(root, 'terminated'))}, 'SIGTERM');
            process.removeAllListeners('SIGTERM');
            process.kill(process.pid, 'SIGTERM');
        });
        process.stdout.on('error', () => {});
        process.stderr.on('error', () => {});
        if (mode === 'slow') {
            const timer = setInterval(() => process.stdout.write(' '), 10);
            setTimeout(() => {
                clearInterval(timer);
                fs.writeFileSync(${JSON.stringify(join(root, 'completed'))}, 'unbounded');
            }, 3000);
        } else {
            const stream = mode.endsWith('stdout') ? process.stdout : process.stderr;
            let chunks = 0;
            const timer = setInterval(() => {
                stream.write(Buffer.alloc(262144, 'x'));
                if (++chunks === 16) {
                    clearInterval(timer);
                    fs.writeFileSync(${JSON.stringify(join(root, 'completed'))}, 'unbounded');
                }
            }, 10);
        }
    } else if (mode === 'signal') {
        if (command === 'rev-parse') process.stdout.write(${JSON.stringify(fixture.commit)} + String.fromCharCode(10));
        fs.writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid));
        setTimeout(() => process.exit(0), 3000);
    } else if (mode === 'silent') {
        if (command === 'rev-parse') process.stdout.write(${JSON.stringify(fixture.commit)} + String.fromCharCode(10));
        process.exit(1);
    } else if (mode === 'stdout') {
        process.stdout.write(command === 'rev-parse' ? ${JSON.stringify(fixture.commit)} + ' '.repeat(1048577) : Buffer.alloc(1048577));
    } else {
        if (command === 'rev-parse') process.stdout.write(${JSON.stringify(fixture.commit)} + String.fromCharCode(10));
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
    expect(started).toMatchObject({
        command,
        head: options.revision,
        cwd: process.cwd(),
    });
    expect(started.directory).not.toBe(await fs.realpath(options.source));
    await expect(fs.stat(started.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'started']);
});

it.each(['rev-parse', 'ls-tree'])('enforces the absolute 30 second deadline for %s despite output', async (command) => {
    const { root, options } = await setup(command, 'slow');
    await expect(prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    expect(deadlines).toContain(30_000);
    expect(discoverSkills).not.toHaveBeenCalled();
    const started = JSON.parse(await fs.readFile(join(root, 'started'), 'utf8'));
    expect(started).toMatchObject({
        command,
        head: options.revision,
        cwd: process.cwd(),
    });
    expect(started.directory).not.toBe(await fs.realpath(options.source));
    await expect(fs.stat(started.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(root, 'terminated'), 'utf8')).toBe('SIGTERM');
    await expect(fs.stat(join(root, 'completed'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'started', 'terminated']);
}, 10_000);

it.each(['rev-parse', 'ls-tree'])('rejects silent nonzero %s before discovery and preserves the previous corpus', async (command) => {
    const { root, options } = await setup(command, 'silent');
    await expect(prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    expect(discoverSkills).not.toHaveBeenCalled();
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('BODY');
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'started']);
});

it.each(['rev-parse', 'ls-tree'])('rejects external SIGTERM of %s before discovery and preserves the previous corpus', async (command) => {
    const { root, options } = await setup(command, 'signal');
    const rejected = expect(prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    await vi.waitFor(() => expect(fs.readFile(join(root, 'pid'), 'utf8')).resolves.toMatch(/^\d+$/u));
    process.kill(Number(await fs.readFile(join(root, 'pid'), 'utf8')), 'SIGTERM');
    await rejected;
    expect(discoverSkills).not.toHaveBeenCalled();
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('BODY');
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'pid', 'started']);
});

it.each(['stdout', 'stderr'])('terminates a SIGINT-resistant %s flood before discovery', async (stream) => {
    const { root, options } = await setup('ls-tree', `resistant-${stream}`);
    await expect(prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    expect(discoverSkills).not.toHaveBeenCalled();
    expect(await fs.readFile(join(root, 'terminated'), 'utf8')).toBe('SIGTERM');
    await expect(fs.stat(join(root, 'completed'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('BODY');
    expect((await fs.readdir(root)).sort()).toEqual(['bin', 'corpus', 'started', 'terminated']);
});
