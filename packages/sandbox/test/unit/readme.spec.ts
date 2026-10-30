/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine, createMemoryStore } from '@chamvi/core';
import { createWorkspaces } from '../fixtures/readme-example.ts';
import { createFakeProvider } from '../utils/provider.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('builds a manager attached to the engine', async () => {
        const engine = new Engine({
            store: createMemoryStore(),
            agents: [],
        });
        const manager = createWorkspaces(createFakeProvider(), engine);

        expect(Object.keys(manager.tools()).sort()).toEqual(['create_workspace', 'dispose_workspace', 'git_fetch', 'git_pull', 'git_push', 'read_repository_instructions']);
        await expect(manager.close()).resolves.toBeUndefined();
    });
});
