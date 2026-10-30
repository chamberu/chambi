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
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';
import { createTriageServer } from '../fixtures/readme-example.ts';
import { START, deliver } from '../utils/app.ts';
import { textModel } from '../utils/model.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const SECRET = 'readme-webhook-secret';

afterEach(() => {
    vi.unstubAllEnvs();
});

function stubEnv() {
    const clock = new ControllableClock(START);
    const fake = createFakeGithub({ appId: '123', clock });

    vi.stubEnv('GITHUB_APP_ID', '123');
    // as an env var usually carries it: one line with literal \n
    vi.stubEnv('GITHUB_PRIVATE_KEY', fake.privateKey.replaceAll('\n', '\\n'));
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('CHAMVI_TOKEN', 'readme-token-0123456789');

    return { clock, fake };
}

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('answers a signed delivery with 202 and runs the agent', async () => {
        const { clock, fake } = stubEnv();
        const {
            app,
            engine,
            shutdown,
        } = await createTriageServer(textModel('Triaged.'), { fetch: fake.fetch, clock });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: read('../fixtures/deliveries/issues-opened.json'),
            secret: SECRET,
        });

        expect(response.status).toBe(202);

        const { runs } = await response.json() as { runs: Array<{ agent: string; runId: string }> };

        expect(runs.map((r) => r.agent)).toEqual(['triage']);
        await engine.idle();
        expect((await engine.getRun(runs[0]!.runId))?.status).toBe('completed');
        await expect(shutdown.shutdown()).resolves.toBeUndefined();
    });

    it('needs the GitHub App settings', async () => {
        stubEnv();
        vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
        await expect(createTriageServer(textModel())).rejects.toThrow('GITHUB_WEBHOOK_SECRET');
    });
});
