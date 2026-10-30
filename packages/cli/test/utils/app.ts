/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    cp,
    mkdtemp,
    rm,
    symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, whose node_modules link every workspace package. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const FIXTURE_APP = fileURLToPath(new URL('../fixtures/app', import.meta.url));

export type TempApp = {
    cwd: string;
    remove(): Promise<void>;
};

/**
 * A temp copy of the fixture app with `node_modules` linked to the
 * repository root's, so `@chamvi/app` and `ai` resolve as in a real repo.
 */
export async function copyFixtureApp(): Promise<TempApp> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-app-'));

    await cp(FIXTURE_APP, cwd, { recursive: true });
    await symlink(path.join(REPO_ROOT, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');

    return {
        cwd,
        remove: () => rm(cwd, { recursive: true, force: true }),
    };
}
