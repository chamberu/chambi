/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../../src/run/module.ts';
import { createFakeProcess } from '../../utils/process.ts';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };

describe('runCli', () => {
    it('--version prints the package version', async () => {
        const fake = createFakeProcess();

        await runCli(['--version'], fake.context());
        expect(fake.stdout.join('')).toBe(`${version}\n`);
        expect(fake.exitCodes).toEqual([]);
    });

    it('--help prints the commands', async () => {
        const fake = createFakeProcess();

        await runCli(['--help'], fake.context());

        const out = fake.stdout.join('');

        ['start', 'run-job', 'migrate'].forEach((command) => expect(out).toContain(command));
        expect(out).not.toContain('doctor');
        expect(fake.exitCodes).toEqual([]);
    });

    it('start --help lists --check', async () => {
        const fake = createFakeProcess();

        await runCli(['start', '--help'], fake.context());
        expect(fake.stdout.join('')).toContain('--check');
    });

    it('<command> --help prints that command', async () => {
        const fake = createFakeProcess();

        await runCli(['run-job', '--help'], fake.context());
        expect(fake.stdout.join('')).toContain('AGENT');
    });

    it('start --help hides --dev (used by chamvi dev)', async () => {
        const fake = createFakeProcess();

        await runCli(['start', '--help'], fake.context());

        const out = fake.stdout.join('');

        expect(out).toContain('--entry');
        expect(out).not.toContain('--dev');
    });

    it('unknown command exits 2 with usage', async () => {
        const fake = createFakeProcess();

        await runCli(['deploy'], fake.context());
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('Unknown command');
        expect(fake.stderr.join('')).toContain('USAGE');
    });

    it('no command exits 2 with usage', async () => {
        const fake = createFakeProcess();

        await runCli([], fake.context());
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('USAGE');
    });
});
