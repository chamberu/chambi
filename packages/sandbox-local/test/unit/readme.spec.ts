/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { createDevWorkspaces } from '../fixtures/readme-example.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'chamvi-local-readme-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('runs a command in a run workspace, finds it again after close and removes it on release', async () => {
        const workspaces = createDevWorkspaces(root);
        const { workspace } = await workspaces.acquire('r1', {});
        const result = await workspace.exec(['echo', 'hi']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('hi\n');

        await expect(workspaces.close()).resolves.toBeUndefined();
        expect(await readdir(root)).toEqual([workspace.id]);

        // a restarted process finds the run's workspace and releases it
        const restarted = createDevWorkspaces(root);

        expect((await restarted.get('r1')).id).toBe(workspace.id);
        await restarted.release('r1');
        expect(await readdir(root)).toEqual([]);
    });
});
