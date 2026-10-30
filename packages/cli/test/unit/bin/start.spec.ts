/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { SIGNAL_REPEAT_MS } from '../../../src/signals/constants.ts';
import { TOKEN, startEnv } from '../../utils/env.ts';
import { freePort } from '../../utils/port.ts';
import {
    count,
    fixtureEntry,
    spawnCli,
    waitForOk,
} from '../../utils/spawn.ts';
import type { CliProcess } from '../../utils/spawn.ts';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };

describe('bin', () => {
    let cli: CliProcess | undefined;

    afterEach(() => {
        cli?.kill();
        cli = undefined;
    });

    it(`--version prints ${version}`, async () => {
        cli = spawnCli(['--version']);
        expect(await cli.exited()).toEqual({ code: 0, signal: null });
        expect(cli.stdout()).toBe(`${version}\n`);
    });

    it('unknown command exits 2 with usage', async () => {
        cli = spawnCli(['deploy']);
        expect((await cli.exited()).code).toBe(2);
        expect(cli.stderr()).toContain('USAGE');
        expect(cli.stderr()).toContain('Unknown command');
    });

    it('starts with the shebang', () => {
        expect(readFileSync(new URL('../../../dist/cli.mjs', import.meta.url), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    });
});

describe('bin start', () => {
    let cli: CliProcess | undefined;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
    });

    afterEach(() => {
        cli?.kill();
        cli = undefined;
    });

    /** Starts the hang agent's run and waits until it is running. */
    async function startHangingRun(): Promise<void> {
        const base = `http://127.0.0.1:${port}`;
        const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
        const response = await fetch(`${base}/agents/hang/runs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ payload: {} }),
        });

        expect(response.status).toBe(202);

        const { runId } = await response.json() as { runId: string };

        const until = Date.now() + 10_000;

        for (;;) {
            const run = await (await fetch(`${base}/runs/${runId}`, { headers })).json() as { status: string };

            if (run.status === 'running') {
                return;
            }

            if (Date.now() > until) {
                throw new Error(`run ${runId} is ${run.status}, not running`);
            }

            await new Promise((resolve) => {
                setTimeout(resolve, 50);
            });
        }
    }

    it('start serves and SIGTERM exits 0 within 10 s', async () => {
        cli = spawnCli(['start', '--entry', fixtureEntry('app')], { env: startEnv(port) });
        await waitForOk(`http://127.0.0.1:${port}/readyz`);

        cli.child.kill('SIGTERM');

        const started = Date.now();

        expect(await cli.exited(10_000)).toEqual({ code: 0, signal: null });
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(count(cli.stderr(), 'received SIGTERM, stopping')).toBe(1);
    });

    it('a second SIGTERM exits 1', async () => {
        cli = spawnCli(['start', '--entry', fixtureEntry('hang')], { env: startEnv(port, { CHAMVI_DRAIN_TIMEOUT_MS: '60000' }) });
        await waitForOk(`http://127.0.0.1:${port}/readyz`);
        await startHangingRun();

        cli.child.kill('SIGTERM');
        await cli.waitForOutput((output) => output.includes('received SIGTERM, stopping'));
        // a repeat within SIGNAL_REPEAT_MS is the same signal delivered twice
        await new Promise((resolve) => {
            setTimeout(resolve, SIGNAL_REPEAT_MS + 100);
        });
        cli.child.kill('SIGTERM');
        expect(await cli.exited(5_000)).toEqual({ code: 1, signal: null });
    });

    it('one Ctrl-C delivered twice (npm and the terminal) still drains and exits 0', async () => {
        cli = spawnCli(['start', '--entry', fixtureEntry('hang')], { env: startEnv(port, { CHAMVI_DRAIN_TIMEOUT_MS: '1000' }) });
        await waitForOk(`http://127.0.0.1:${port}/readyz`);
        await startHangingRun();

        cli.child.kill('SIGINT');
        cli.child.kill('SIGINT');

        const started = Date.now();

        expect(await cli.exited(10_000)).toEqual({ code: 0, signal: null });
        expect(Date.now() - started).toBeGreaterThanOrEqual(900);
        expect(cli.stderr()).not.toContain('forced exit');
    });

    it('CHAMVI_FORCE_EXIT_MS forces exit 1', async () => {
        cli = spawnCli(['start', '--entry', fixtureEntry('hang')], {
            env: startEnv(port, {
                CHAMVI_DRAIN_TIMEOUT_MS: '60000',
                CHAMVI_FORCE_EXIT_MS: '500',
            }),
        });
        await waitForOk(`http://127.0.0.1:${port}/readyz`);
        await startHangingRun();

        cli.child.kill('SIGTERM');

        const started = Date.now();

        expect(await cli.exited(10_000)).toEqual({ code: 1, signal: null });
        expect(Date.now() - started).toBeGreaterThanOrEqual(400);
        expect(cli.stderr()).toContain('forced exit');
    });
});
