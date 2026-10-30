/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { runCli } from '../../../src/run/module.ts';
import { copyFixtureApp } from '../../utils/app.ts';
import type { TempApp } from '../../utils/app.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

async function exists(file: string): Promise<boolean> {
    try {
        await stat(file);

        return true;
    } catch {
        return false;
    }
}

describe('build', () => {
    let fake: FakeProcess;
    let app: TempApp;

    beforeEach(async () => {
        fake = createFakeProcess();
        app = await copyFixtureApp();
    });

    afterEach(async () => {
        await app.remove();
    });

    it('builds dist/index.mjs with dependencies external', async () => {
        await runCli(['build'], fake.context({ cwd: app.cwd }));
        expect(fake.exitCodes).toEqual([]);

        const bundle = await readFile(path.join(app.cwd, 'dist/index.mjs'), 'utf8');

        expect(await exists(path.join(app.cwd, 'dist/index.mjs.map'))).toBe(true);
        expect(bundle).toContain('from "@chamvi/app"');
        expect(bundle).toContain('from "ai/test"');
        // the agents module is source, so inlined
        expect(bundle).toContain('Echo the payload back.');
        expect(await exists(path.join(app.cwd, 'dist/agents.mjs'))).toBe(false);
    });

    it('--out-dir', async () => {
        await runCli(['build', '--out-dir', 'build'], fake.context({ cwd: app.cwd }));
        expect(fake.exitCodes).toEqual([]);
        expect(await exists(path.join(app.cwd, 'build/index.mjs'))).toBe(true);
        expect(await exists(path.join(app.cwd, 'dist'))).toBe(false);
    });

    it('builds again over its own output', async () => {
        await runCli(['build'], fake.context({ cwd: app.cwd }));
        await runCli(['build'], fake.context({ cwd: app.cwd }));
        expect(fake.exitCodes).toEqual([]);
        expect(await exists(path.join(app.cwd, 'dist/index.mjs'))).toBe(true);
    });

    it.each([
        ['src', 'holds the entry'],
        ['.', 'is the project folder or above it'],
        ['..', 'is the project folder or above it'],
        ['notes', 'holds files the build did not write'],
    ])('--out-dir %s exits 2 and deletes nothing', async (outDir, reason) => {
        await mkdir(path.join(app.cwd, 'notes'));
        await writeFile(path.join(app.cwd, 'notes/todo.md'), 'keep me');

        await runCli(['build', '--out-dir', outDir], fake.context({ cwd: app.cwd }));

        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain(reason);
        expect(await exists(path.join(app.cwd, 'src/index.ts'))).toBe(true);
        expect(await exists(path.join(app.cwd, 'src/agents.ts'))).toBe(true);
        expect(await exists(path.join(app.cwd, 'notes/todo.md'))).toBe(true);
    });

    it('--entry', async () => {
        await runCli(['build', '--entry', 'src/agents.ts'], fake.context({ cwd: app.cwd }));
        expect(fake.exitCodes).toEqual([]);

        const bundle = await readFile(path.join(app.cwd, 'dist/index.mjs'), 'utf8');

        expect(bundle).not.toContain('createApp');
    });

    it('missing tsdown exits 2', async () => {
        const importModule = async (specifier: string) => {
            const error = new Error(`Cannot find package '${specifier}' imported from /app`);

            Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' });

            throw error;
        };

        await runCli(['build'], { ...fake.context({ cwd: app.cwd }), importModule });
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('chamvi build needs tsdown: npm install --save-dev tsdown');
    });

    it('another missing module of tsdown exits 1', async () => {
        const importModule = async () => {
            const error = new Error('Cannot find package \'rolldown\' imported from /tsdown');

            Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' });

            throw error;
        };

        await runCli(['build'], { ...fake.context({ cwd: app.cwd }), importModule });
        expect(fake.exitCodes).toEqual([1]);
    });

    it('a syntax error exits 1', async () => {
        await writeFile(path.join(app.cwd, 'src/index.ts'), 'export default createApp({ agents: [ };\n');
        await runCli(['build'], fake.context({ cwd: app.cwd }));
        expect(fake.exitCodes).toEqual([1]);
        expect(await exists(path.join(app.cwd, 'dist/index.mjs'))).toBe(false);
    });

    it('without any entry file exits 2: nothing to build', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-build-'));

        try {
            await runCli(['build'], fake.context({ cwd }));
            expect(fake.exitCodes).toEqual([2]);
            expect(fake.stderr.join('')).toContain('nothing to build');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    it('a missing entry exits 2', async () => {
        await runCli(['build', '--entry', 'src/nope.ts'], fake.context({ cwd: app.cwd }));
        expect(fake.exitCodes).toEqual([2]);
    });
});
