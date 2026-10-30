/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawnSync } from 'node:child_process';
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { INNER_SCRIPT } from '../../../src/tools/constants.ts';

/** The shells of this host the inner script may run under (dash is sh on Debian and Ubuntu). */
const SHELLS = ['sh', 'dash', 'bash'].filter((shell) => spawnSync(shell, ['-c', 'true']).status === 0);

let state: string;

beforeEach(async () => {
    state = await mkdtemp(join(tmpdir(), 'chamvi-inner-'));
});
afterEach(async () => {
    await rm(state, { recursive: true, force: true });
});

function run(shell: string, command: string) {
    return spawnSync(shell, ['-c', INNER_SCRIPT, 'chamvi', command, '', state], { cwd: state, encoding: 'utf8' });
}

describe.each(SHELLS)('the inner shell under %s', (shell) => {
    it('runs the command over a torn env file and saves a whole one', async () => {
        // two parallel saves that interleaved: the file ends inside a quote
        await writeFile(join(state, 'env'), 'export KEPT="yes"\nexport TORN="ab');

        const result = run(shell, 'echo ran; export NEXT=1');

        expect(result.stdout).toBe('ran\n');
        expect(result.status).toBe(0);

        const saved = await readFile(join(state, 'env'), 'utf8');

        expect(saved).toContain('NEXT');
        expect(spawnSync('sh', ['-n', join(state, 'env')]).status).toBe(0);
        expect(run(shell, 'echo "$NEXT"').stdout).toBe('1\n');
    });

    it('leaves no temporary file behind', async () => {
        expect(run(shell, 'cd /; export A=1').status).toBe(0);
        expect((await readdir(state)).sort()).toEqual(['cwd', 'env']);
    });
});
