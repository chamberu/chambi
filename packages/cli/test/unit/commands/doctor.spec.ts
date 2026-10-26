/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_BRAND } from '@chamvi/app';
import type { Env } from '@chamvi/app';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { runCli } from '../../../src/run/module.ts';
import type { CliContext } from '../../../src/run/types.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}/src/index.ts`, import.meta.url));

const SECRET = 'sk-doctor-secret-0001';

describe('doctor', () => {
    let fake: FakeProcess;

    beforeEach(() => {
        // every test imports a fresh entry, so a fresh App
        vi.resetModules();
        fake = createFakeProcess();
    });

    async function doctor(args: string[], env: Env = {}, extra: Partial<CliContext> = {}) {
        await runCli(['doctor', ...args], { ...fake.context({ env, cwd: extra.cwd }), ...extra });
    }

    it('reports an app that would start and exits 0', async () => {
        await doctor(['--entry', fixture('app')]);
        expect(fake.exitCodes).toEqual([0]);
        expect(fake.stdout.join('')).toContain('echo');
        // no signal handlers: nothing to stop
        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
    });

    it('names the missing key of a built-in provider and exits 2', async () => {
        await doctor(['--entry', fixture('keyless')]);
        expect(fake.exitCodes).toEqual([2]);
        const out = fake.stdout.join('');
        expect(out).toContain('triage');
        expect(out).toContain('ANTHROPIC_API_KEY');
    });

    it('lists declared providers with header names, never a secret', async () => {
        await doctor(['--entry', fixture('providers')], { CHAMVI_PROVIDER_TEAM_A_API_KEY: SECRET });
        expect(fake.exitCodes).toEqual([2]);
        const out = fake.stdout.join('');
        expect(out).toContain('team-a');
        expect(out).toContain('x-team');
        expect(out).toContain('triage');
        expect(out).toContain('other');
        expect(out).toContain('nope');
        expect(out).not.toContain(SECRET);
        expect(fake.stderr.join('')).not.toContain(SECRET);
    });

    it('refuses an unknown flag with exit 2', async () => {
        await doctor(['--entry', fixture('app'), '--nope']);
        expect(fake.exitCodes).toEqual([2]);
    });

    it('refuses an app of another @chamvi/app copy without inspect()', async () => {
        await doctor(['--entry', fixture('app')], {}, { importModule: async () => ({ default: { [APP_BRAND]: true } }) });
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('@chamvi/app');
    });

    describe('entry and .env', () => {
        let cwd: string;
        let imported: string[];
        let importModule: CliContext['importModule'];

        beforeEach(async () => {
            cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-doctor-'));
            const reexport = `export { default } from ${JSON.stringify(pathToFileURL(fixture('keyless')).href)};\n`;
            await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ type: 'module', chamvi: { entry: 'app.ts' } }));
            await writeFile(path.join(cwd, 'app.ts'), reexport);
            await mkdir(path.join(cwd, 'dist'));
            await writeFile(path.join(cwd, 'dist', 'index.mjs'), reexport);
            await writeFile(path.join(cwd, '.env'), 'ANTHROPIC_API_KEY=sk-from-the-env-file\n');
            imported = [];
            importModule = (specifier) => {
                imported.push(specifier);
                return import(specifier);
            };
        });

        afterEach(async () => {
            await rm(cwd, { recursive: true, force: true });
        });

        it('--dev resolves the source entry (chamvi.entry) and loads .env', async () => {
            const env: Env = {};
            await doctor(['--dev'], env, { cwd, importModule });
            expect(imported).toEqual([pathToFileURL(path.join(cwd, 'app.ts')).href]);
            expect(env.ANTHROPIC_API_KEY).toBe('sk-from-the-env-file');
            expect(fake.exitCodes).toEqual([0]);
            expect(fake.stdout.join('')).not.toContain('sk-from-the-env-file');
        });

        it('plain doctor resolves the built entry and reads no .env', async () => {
            const env: Env = {};
            await doctor([], env, { cwd, importModule });
            expect(imported).toEqual([pathToFileURL(path.join(cwd, 'dist', 'index.mjs')).href]);
            expect(env.ANTHROPIC_API_KEY).toBeUndefined();
            expect(fake.exitCodes).toEqual([2]);
            expect(fake.stdout.join('')).toContain('ANTHROPIC_API_KEY');
        });
    });
});
