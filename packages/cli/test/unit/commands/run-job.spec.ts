/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { fileURLToPath } from 'node:url';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { runCli } from '../../../src/run/module.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}/src/index.ts`, import.meta.url));

describe('run-job', () => {
    let fake: FakeProcess;

    beforeEach(() => {
        vi.resetModules();
        fake = createFakeProcess();
    });

    async function runJob(args: string[]) {
        await runCli(['run-job', ...args], fake.context({ env: { CHAMVI_DRAIN_TIMEOUT_MS: '1000' } }));
    }

    it('completed exits 0', async () => {
        await runJob(['echo', '--entry', fixture('app')]);
        expect(fake.exitCodes).toEqual([0]);
        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
    });

    it('takes the subscription id as the second argument', async () => {
        await runJob(['echo', 'cron:0 0 1 1 *', '--entry', fixture('app')]);
        expect(fake.exitCodes).toEqual([0]);
    });

    it('failed exits 1', async () => {
        await runJob(['fail', '--entry', fixture('failing')]);
        expect(fake.exitCodes).toEqual([1]);
    });

    it('unknown agent exits 2', async () => {
        await runJob(['nope', '--entry', fixture('app')]);
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('nope');
    });

    it('missing agent argument exits 2 with usage', async () => {
        await runJob(['--entry', fixture('app')]);
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('AGENT');
        expect(fake.stderr.join('')).toContain('USAGE');
    });

    it.each([
        [['--entry']],
        [['--entry=']],
        [['--no-entry']],
    ])('%j without a path exits 2', async (flags) => {
        await runJob(['echo', ...flags]);
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('--entry needs a path');
    });

    it('a run interrupted by a signal exits 0', async () => {
        globalThis.chamviHangStreaming = undefined;

        const job = runJob(['hang', '--entry', fixture('hang')]);

        await vi.waitFor(() => expect(globalThis.chamviHangStreaming).toBe(true));

        fake.signals.emit('SIGTERM');
        await job;

        await vi.waitFor(() => expect(fake.exitCodes).toEqual([0]));
        expect(fake.exits).toEqual([]);
        expect(fake.stdout.join('')).toContain('hang: interrupted (run ');
    });

    it('a failed run exits 1 also when a signal arrives during the teardown', async () => {
        globalThis.chamviFailingDrained = () => fake.signals.emit('SIGTERM');

        try {
            await runJob(['fail', '--entry', fixture('failing')]);
        } finally {
            globalThis.chamviFailingDrained = undefined;
        }

        await vi.waitFor(() => expect(fake.exitCodes.length).toBeGreaterThan(0));
        expect(fake.exitCodes.at(-1)).toBe(1);
        expect(fake.stdout.join('')).toContain('fail: failed');
        expect(fake.exits).toEqual([]);
    });

    it('unknown flag exits 2', async () => {
        await runJob(['echo', '--entry', fixture('app'), '--colour']);
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('--colour');
    });
});
