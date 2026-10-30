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
import { createAgentServer } from '../fixtures/readme-example.ts';
import { textModel } from '../utils/model.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const TOKEN = 'readme-token-0123456789';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('starts runs over REST and shuts down', async () => {
        vi.stubEnv('CHAMVI_TOKEN', TOKEN);

        const { app, shutdown } = await createAgentServer(textModel());
        const response = await app.fetch(new Request('http://test/agents/echo/runs', {
            method: 'POST',
            headers: { authorization: `Bearer ${TOKEN}` },
        }));

        expect(response.status).toBe(202);
        await expect(shutdown.shutdown()).resolves.toBeUndefined();
    });

    it('needs CHAMVI_TOKEN', async () => {
        vi.stubEnv('CHAMVI_TOKEN', '');
        await expect(createAgentServer(textModel())).rejects.toThrow('CHAMVI_TOKEN');
    });
});
