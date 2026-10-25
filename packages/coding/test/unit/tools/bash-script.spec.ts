/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { BASH_SCRIPT, INNER_SCRIPT } from '../../../src/tools/constants.ts';

let home: string;

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

/** Runs one call of BASH_SCRIPT in its own process group, as an exec does; resolves with that group once the script exited. */
function runCall(command: string): Promise<{ pgid: number; status: number | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', BASH_SCRIPT, 'sh', INNER_SCRIPT, command, '0123456789ab', '', String(1_048_576), String(4_194_304)], {
            cwd: home,
            env: { ...process.env, HOME: home },
            detached: true,
            stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('exit', (status) => resolve({ pgid: child.pid as number, status }));
    });
}

describe('the bash script', () => {
    it('leaves no process of the call behind once it exited (the watchdog reaps its sleep)', async () => {
        // long enough for the watchdog to sit in its sleep when the command ends
        const { pgid, status } = await runCall('sleep 0.5');
        expect(status).toBe(0);
        // an orphaned sleep would be reparented to PID 1, a zombie for good where PID 1 reaps nothing
        expect(groupAlive(pgid)).toBe(false);
    });
});
