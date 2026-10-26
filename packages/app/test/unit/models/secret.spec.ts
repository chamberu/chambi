/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { readSecret } from '../../../src/models/secret.ts';

describe('readSecret', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'chamvi-secret-'));
    });

    afterEach(async () => {
        delete process.env.CHAMVI_SECRET_SPEC_ONLY;
        await rm(cwd, { recursive: true, force: true });
    });

    it('returns a literal as is', async () => {
        await expect(readSecret('sk-1', {
            env: {},
            cwd,
            field: 'f',
        })).resolves.toBe('sk-1');
    });

    it('reads { env } from the given env', async () => {
        await expect(readSecret({ env: 'TEAM_KEY' }, {
            env: { TEAM_KEY: 'k1' },
            cwd,
            field: 'f',
        })).resolves.toBe('k1');
    });

    it('never reads { env } from process.env', async () => {
        process.env.CHAMVI_SECRET_SPEC_ONLY = 'from-process';
        const promise = readSecret({ env: 'CHAMVI_SECRET_SPEC_ONLY' }, {
            env: {},
            cwd,
            field: 'providers.a.apiKey',
        });
        await expect(promise).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(promise).rejects.toThrow(/providers\.a\.apiKey/);
        await expect(promise).rejects.toThrow(/CHAMVI_SECRET_SPEC_ONLY/);
    });

    it('treats an empty variable as unset', async () => {
        await expect(readSecret({ env: 'K' }, {
            env: { K: '' },
            cwd,
            field: 'f',
        })).rejects.toThrow(/K/);
    });

    it('reads { file } relative to cwd, trimming one trailing newline', async () => {
        await writeFile(join(cwd, 'key'), 'k1\n');
        await writeFile(join(cwd, 'two'), 'k2\n\n');
        await expect(readSecret({ file: 'key' }, {
            env: {},
            cwd,
            field: 'f',
        })).resolves.toBe('k1');
        await expect(readSecret({ file: 'two' }, {
            env: {},
            cwd,
            field: 'f',
        })).resolves.toBe('k2\n');
    });

    it('trims a CRLF line end as one newline', async () => {
        await writeFile(join(cwd, 'key'), 'k1\r\n');
        await expect(readSecret({ file: 'key' }, {
            env: {},
            cwd,
            field: 'f',
        })).resolves.toBe('k1');
    });

    it('reads { file } at an absolute path', async () => {
        await writeFile(join(cwd, 'key'), 'k1');
        await expect(readSecret({ file: join(cwd, 'key') }, {
            env: {},
            cwd: '/',
            field: 'f',
        })).resolves.toBe('k1');
    });

    it('names field and path of a missing file', async () => {
        const promise = readSecret({ file: 'missing-key' }, {
            env: {},
            cwd,
            field: 'providers.a.apiKey',
        });
        await expect(promise).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(promise).rejects.toThrow(/providers\.a\.apiKey/);
        await expect(promise).rejects.toThrow(/missing-key/);
    });

    it('refuses an empty secret', async () => {
        await writeFile(join(cwd, 'empty'), '\n');
        await expect(readSecret({ file: 'empty' }, {
            env: {},
            cwd,
            field: 'f',
        })).rejects.toThrow(/f/);
        await expect(readSecret('', {
            env: {},
            cwd,
            field: 'f',
        })).rejects.toThrow(/f/);
    });

    it('refuses a value of another shape', async () => {
        await expect(readSecret({ vault: 'x' } as never, {
            env: {},
            cwd,
            field: 'f',
        })).rejects.toThrow(/f/);
        await expect(readSecret(42 as never, {
            env: {},
            cwd,
            field: 'f',
        })).rejects.toThrow(/f/);
    });
});
