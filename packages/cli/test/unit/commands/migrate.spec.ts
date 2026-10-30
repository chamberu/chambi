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

const entry = fileURLToPath(new URL('../../fixtures/app/src/index.ts', import.meta.url));

describe('migrate', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('without DATABASE_URL exits 2 naming it', async () => {
        const fake = createFakeProcess();

        await runCli(['migrate', '--entry', entry], fake.context({ env: {} }));
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('DATABASE_URL');
    });

    it('installs no signal handlers', async () => {
        const fake = createFakeProcess();
        const done = runCli(['migrate', '--entry', entry], fake.context({ env: {} }));

        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
        await done;
    });
});
