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
import { fileURLToPath } from 'node:url';
import { ChamviError, InvalidAgentDefinitionError, isApp } from '@chamvi/app';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { DEFAULT_APP_NOTICE } from '../../../src/entry/constants.ts';
import { loadApp, loadEntryApp, resolveEntry } from '../../../src/entry/module.ts';
import { CLI_USAGE_ERROR_CODE, EXIT_CODE } from '../../../src/run/constants.ts';
import { exitCodeOf } from '../../../src/run/helpers.ts';

const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const importModule = (specifier: string) => import(specifier);

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('expected a rejection');
}

describe('resolveEntry', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-entry-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    async function touch(file: string, content = '') {
        await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
        await writeFile(path.join(cwd, file), content);
    }

    it('resolves --entry relative to cwd', async () => {
        await touch('app/main.ts');
        await expect(resolveEntry({
            cwd,
            entry: 'app/main.ts',
            kind: 'built',
        })).resolves.toBe(path.join(cwd, 'app/main.ts'));
    });

    it('keeps an absolute --entry', async () => {
        await touch('app/main.ts');

        const entry = path.join(cwd, 'app/main.ts');

        await expect(resolveEntry({
            cwd: tmpdir(),
            entry,
            kind: 'source',
        })).resolves.toBe(entry);
    });

    it('reads chamvi.entry from package.json for a source entry', async () => {
        await touch('package.json', JSON.stringify({ chamvi: { entry: 'lib/app.ts' } }));
        await touch('lib/app.ts');
        await expect(resolveEntry({ cwd, kind: 'source' })).resolves.toBe(path.join(cwd, 'lib/app.ts'));
    });

    it('ignores chamvi.entry for a built entry', async () => {
        await touch('package.json', JSON.stringify({ chamvi: { entry: 'src/index.ts' } }));
        await touch('src/index.ts');
        await touch('dist/index.mjs');
        await expect(resolveEntry({ cwd, kind: 'built' })).resolves.toBe(path.join(cwd, 'dist/index.mjs'));
    });

    it('defaults to src/index.ts for a source entry', async () => {
        await touch('package.json', JSON.stringify({ name: 'x' }));
        await touch('src/index.ts');
        await expect(resolveEntry({ cwd, kind: 'source' })).resolves.toBe(path.join(cwd, 'src/index.ts'));
    });

    it('defaults to src/index.ts without a package.json', async () => {
        await touch('src/index.ts');
        await expect(resolveEntry({ cwd, kind: 'source' })).resolves.toBe(path.join(cwd, 'src/index.ts'));
    });

    it('refuses a missing built entry beside a source entry with the build hint', async () => {
        await touch('src/index.ts');

        const error = await rejectionOf(resolveEntry({ cwd, kind: 'built' }));

        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe(CLI_USAGE_ERROR_CODE);
        expect((error as Error).message).toContain('dist/index.mjs not found');
        expect((error as Error).message).toContain('run `chamvi build` or pass --entry src/index.ts');
        expect(exitCodeOf(error)).toBe(EXIT_CODE.USAGE);
    });

    it('refuses a missing --entry', async () => {
        const error = await rejectionOf(resolveEntry({
            cwd,
            entry: 'nope.ts',
            kind: 'source',
        }));

        expect((error as ChamviError).code).toBe(CLI_USAGE_ERROR_CODE);
        expect((error as Error).message).toContain('nope.ts not found');
    });

    it('is undefined without any entry file, so the command runs the default app', async () => {
        await expect(resolveEntry({ cwd, kind: 'source' })).resolves.toBeUndefined();
        await expect(resolveEntry({ cwd, kind: 'built' })).resolves.toBeUndefined();
    });

    it('refuses a missing chamvi.entry file', async () => {
        await touch('package.json', JSON.stringify({ chamvi: { entry: 'lib/app.ts' } }));

        const error = await rejectionOf(resolveEntry({ cwd, kind: 'source' }));

        expect((error as ChamviError).code).toBe(CLI_USAGE_ERROR_CODE);
        expect((error as Error).message).toContain('lib/app.ts (package.json chamvi.entry) not found');
    });

    it('refuses a chamvi.entry that is no non-empty string', async () => {
        await touch('package.json', JSON.stringify({ chamvi: { entry: 42 } }));

        const error = await rejectionOf(resolveEntry({ cwd, kind: 'source' }));

        expect((error as ChamviError).code).toBe(CLI_USAGE_ERROR_CODE);
        expect((error as Error).message).toContain('chamvi.entry');
    });
});

describe('loadApp', () => {
    it('loads the default export of the fixture app', async () => {
        const app = await loadApp(path.join(fixtures, 'app/src/index.ts'), importModule);

        expect(isApp(app)).toBe(true);
        expect(app.agents.map((agent) => agent.name)).toEqual(['echo']);
    });

    it('refuses an entry whose default export is no app', async () => {
        const entry = path.join(fixtures, 'broken/not-an-app.ts');
        const error = await rejectionOf(loadApp(entry, importModule));

        expect((error as ChamviError).code).toBe(CLI_USAGE_ERROR_CODE);
        expect((error as Error).message).toContain(`${entry} must \`export default createApp`);
        expect(exitCodeOf(error)).toBe(EXIT_CODE.USAGE);
    });

    it('passes a configuration error of the entry import through', async () => {
        const error = await rejectionOf(loadApp(path.join(fixtures, 'broken/throws-config.ts'), importModule));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(exitCodeOf(error)).toBe(EXIT_CODE.USAGE);
    });

    it('imports through a file URL', async () => {
        const specifiers: string[] = [];

        await loadApp(path.join(fixtures, 'app/src/index.ts'), (specifier) => {
            specifiers.push(specifier);

            return import(specifier);
        });
        expect(specifiers[0]).toMatch(/^file:\/\/.*\/fixtures\/app\/src\/index\.ts$/);
    });
});

describe('loadEntryApp', () => {
    it('loads the entry when there is one, writing nothing', async () => {
        const written: string[] = [];
        const app = await loadEntryApp(path.join(fixtures, 'app/src/index.ts'), {
            importModule,
            stderr: (text) => {
                written.push(text);
            },
        });

        expect(app.agents.map((agent) => agent.name)).toEqual(['echo']);
        expect(written).toEqual([]);
    });

    it('without an entry builds the default app and says so', async () => {
        const written: string[] = [];
        const app = await loadEntryApp(undefined, {
            importModule: () => Promise.reject(new Error('no import expected')),
            stderr: (text) => {
                written.push(text);
            },
        });

        expect(isApp(app)).toBe(true);
        expect(app.agents).toEqual([]);
        expect(written).toEqual([DEFAULT_APP_NOTICE]);
    });
});
