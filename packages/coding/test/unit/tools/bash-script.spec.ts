/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BASH_SCRIPT, INNER_SCRIPT, REPORT_SCRIPT } from '../../../src/tools/constants.ts';

/** The id of the call each test runs. */
const CALL_ID = '0123456789ab';

let home: string;
/** The groups of the calls a test started, killed after it. */
const groups: number[] = [];

beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'chamvi-bash-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

/** Whether any process of the group `pgid` still runs (signal 0). */
function groupAlive(pgid: number): boolean {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Starts one call of BASH_SCRIPT in its own process group, as an exec does (its pid is the group). */
function startCall(command: string, cap = 1_048_576): ChildProcess {
    return spawn('sh', ['-c', BASH_SCRIPT, 'sh', INNER_SCRIPT, command, CALL_ID, '', String(cap), String(cap * 4)], {
        cwd: home,
        env: { ...process.env, HOME: home },
        detached: true,
        stdio: 'ignore',
    });
}

/** Resolves with the exit status of a call once its script exited. */
function exited(child: ChildProcess): Promise<number | null> {
    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (status, signal) => resolve(status ?? (signal ? -1 : null)));
    });
}

/** Runs one call of BASH_SCRIPT; resolves with its group once the script exited. */
async function runCall(command: string, cap?: number): Promise<{ pgid: number; status: number | null }> {
    const child = startCall(command, cap);
    const status = await exited(child);
    return { pgid: child.pid as number, status };
}

/** The size of a log of the call, 0 when it is gone. */
async function logSize(stream: 'stdout' | 'stderr'): Promise<number> {
    try {
        return (await stat(join(home, '.chamvi', 'out', `${CALL_ID}.${stream}.log`))).size;
    } catch {
        return 0;
    }
}

describe('the bash script', () => {
    afterEach(() => {
        // never leave a call's processes behind a failed test
        for (const pgid of groups) {
            try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
        }
        groups.length = 0;
    });

    it('leaves no process of the call behind once it exited (the watchdog reaps its sleep)', async () => {
        // long enough for the watchdog to sit in its sleep when the command ends
        const { pgid, status } = await runCall('sleep 0.5');
        expect(status).toBe(0);
        // an orphaned sleep would be reparented to PID 1, a zombie for good where PID 1 reaps nothing
        expect(groupAlive(pgid)).toBe(false);
    });

    it('ends the whole call when only its shell gets TERM, as from BusyBox timeout', async () => {
        const child = startCall(`sleep 0.2; sleep 30; touch "${join(home, 'after')}"`);
        const pgid = child.pid as number;
        groups.push(pgid);
        const status = exited(child);
        await new Promise((resolve) => { setTimeout(resolve, 600); });
        // BusyBox timeout execs the command and signals that one process only
        process.kill(pgid, 'SIGTERM');
        await status;
        await vi.waitFor(() => { expect(groupAlive(pgid)).toBe(false); }, { timeout: 2_000 });
        await expect(stat(join(home, 'after'))).rejects.toThrow();
    });

    it('keeps a quiet process the command leaves running, and its watchdog ends with it', async () => {
        const started = Date.now();
        const { pgid, status } = await runCall('sleep 1.5 & echo started');
        groups.push(pgid);
        expect(status).toBe(0);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(groupAlive(pgid)).toBe(true);
        await vi.waitFor(() => { expect(groupAlive(pgid)).toBe(false); }, { timeout: 5_000, interval: 100 });
    });

    it('kills a process the command leaves writing to its log once the log passes the cap', async () => {
        const cap = 65_536;
        const { pgid } = await runCall('echo started; (while :; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done) &', cap);
        groups.push(pgid);
        await vi.waitFor(() => { expect(groupAlive(pgid)).toBe(false); }, { timeout: 5_000, interval: 100 });
        // a cap passed while the script still ran is cut by the report read afterwards, as the tool does
        await exited(spawn('sh', ['-c', REPORT_SCRIPT, 'sh', CALL_ID, String(cap), String(cap * 4)], {
            cwd: home,
            env: { ...process.env, HOME: home },
            stdio: 'ignore',
        }));
        expect(await logSize('stdout')).toBeLessThanOrEqual(cap);
    });
});
