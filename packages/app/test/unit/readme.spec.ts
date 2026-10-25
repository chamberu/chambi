/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    describe,
    expect,
    it,
} from 'vitest';
import app from '../fixtures/readme-example.ts';
import { freePort } from '../utils/port.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = Array.from(readme.matchAll(/```typescript\n([\s\S]*?)```/g), (m) => m[1]);
        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('starts and stops', async () => {
        const port = await freePort();
        await app.start({
            env: {
                CHAMVI_TOKENS: JSON.stringify([{
                    value: 'a-static-token-of-16+',
                    id: 'ops',
                    permissions: ['*'],
                }]),
                PORT: String(port),
                HOST: '127.0.0.1',
                // builds the anthropic provider; nothing calls the model
                ANTHROPIC_API_KEY: 'sk-test',
            },
        });

        try {
            const response = await fetch(`http://127.0.0.1:${port}/readyz`);
            expect(response.status).toBe(200);
        } finally {
            await expect(app.stop()).resolves.toBeUndefined();
        }
    });
});
