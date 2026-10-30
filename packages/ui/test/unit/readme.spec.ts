/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { app } from '../fixtures/readme-example.ts';
import { get } from '../utils/app.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('serves the built dashboard', async () => {
        const response = await get(app, '/ui/');

        expect(response.status).toBe(200);

        const html = await response.text();

        expect(html).toContain('<base href="/ui/">');
        expect(html).toContain('id="chamvi-config"');
    });
});
