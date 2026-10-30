/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { createSandbox } from '../fixtures/readme-example.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('builds the provider without contacting the daemon', () => {
        // a socket that does not exist: any request would fail
        vi.stubEnv('DOCKER_HOST', 'unix:///nonexistent');

        const sandbox = createSandbox();

        expect(sandbox.name).toBe('docker');
    });
});
