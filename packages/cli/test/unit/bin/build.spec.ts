/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { copyFixtureApp } from '../../utils/app.ts';
import type { TempApp } from '../../utils/app.ts';
import { startEnv } from '../../utils/env.ts';
import { freePort } from '../../utils/port.ts';
import { spawnCli, waitForOk } from '../../utils/spawn.ts';
import type { CliProcess } from '../../utils/spawn.ts';

describe('bin build', () => {
    let app: TempApp;
    let cli: CliProcess | undefined;

    beforeEach(async () => {
        app = await copyFixtureApp();
    });

    afterEach(async () => {
        cli?.kill();
        cli = undefined;
        await app.remove();
    });

    it('build, then start runs dist/index.mjs', async () => {
        cli = spawnCli(['build'], { cwd: app.cwd });
        expect((await cli.exited(60_000)).code).toBe(0);

        const port = await freePort();

        cli = spawnCli(['start'], { cwd: app.cwd, env: startEnv(port) });
        await waitForOk(`http://127.0.0.1:${port}/readyz`);
        cli.child.kill('SIGTERM');
        expect((await cli.exited(10_000)).code).toBe(0);
    });
});
