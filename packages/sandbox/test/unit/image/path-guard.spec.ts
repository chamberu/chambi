/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { IMAGE_PROBE_SCRIPT, PATH_GUARD_SCRIPT } from '../../../src/image/constants.ts';
import { EXEC_SCRIPT } from '../../../src/remote/constants.ts';

/** The PATH a script leaves for the command it runs, through the host's /bin/sh. */
function pathAfter(script: string, path: string): string {
    const result = spawnSync('/bin/sh', ['-c', `${script}\nprintf %s "$PATH"`], { env: { PATH: path }, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    return result.stdout;
}

describe('the PATH guard of chamvi\'s own commands', () => {
    it('drops every PATH entry in the shared cache', () => {
        expect(pathAfter(PATH_GUARD_SCRIPT, '/cache/mise/shims:/usr/bin:/cache:/bin:/cache/evil/bin'))
            .toBe('/usr/bin:/bin');
    });

    it('keeps a PATH without a cache entry as it is, also folders that only start like it', () => {
        expect(pathAfter(PATH_GUARD_SCRIPT, '/usr/bin:/cachex/bin:/bin:/opt/cache')).toBe('/usr/bin:/cachex/bin:/bin:/opt/cache');
    });

    it('runs every workspace command (the timeout wrapper, the checkout) on the guarded PATH', () => {
        const result = spawnSync('/bin/sh', ['-c', EXEC_SCRIPT, 'sh', 'M:', '/', '/bin/sh', '-c', 'printf %s "$PATH"'], {
            env: { PATH: '/cache/mise/shims:/usr/bin:/bin' },
            encoding: 'utf8',
        });
        expect(result.stdout).toBe('/usr/bin:/bin');
        expect(result.stderr).toBe('M:0\n');
        expect(result.status).toBe(0);
    });

    it('guards the image probe too', () => {
        expect(IMAGE_PROBE_SCRIPT.startsWith(`${PATH_GUARD_SCRIPT}\n`)).toBe(true);
    });
});
