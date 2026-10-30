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
import { ControllableClock } from '@chamvi/test-kit';
import { createApprovalEngine } from '../fixtures/readme-example.ts';
import { approvalModel } from '../utils/model.ts';
import { createFakeOpenclaw } from '../utils/openclaw.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const TOKEN = 'readme-hooks-token-0123456789';

function stubEnv() {
    vi.stubEnv('OPENCLAW_URL', 'http://openclaw:18789');
    vi.stubEnv('OPENCLAW_HOOKS_TOKEN', TOKEN);
    vi.stubEnv('OPENCLAW_CHANNEL', 'telegram');
    vi.stubEnv('OPENCLAW_TO', '12345');
    vi.stubEnv('APP_URL', 'https://chamvi.example');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('pauses a deploy and asks in the chat once', async () => {
        stubEnv();

        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeOpenclaw({ token: TOKEN, clock });
        const engine = createApprovalEngine(approvalModel('deploy', { env: 'prod' }), { fetch: fake.fetch, clock });

        await engine.start();

        try {
            const { runId } = await engine.dispatch({
                agent: 'deployer',
                trigger: 'http',
                channel: 'http',
                payload: { release: 'v1.2.0' },
            });

            await engine.idle();
            expect((await engine.getRun(runId))?.status).toBe('waiting');
            expect(fake.dispatched).toHaveLength(1);

            const { message } = fake.dispatched[0]!;
            const { approvalId } = (await engine.getRun(runId))!.waiting!;

            expect(message).toContain(`Approve or deny: https://chamvi.example/ui/approvals?run=${runId}&approval=${encodeURIComponent(approvalId)}`);
            expect(message).not.toContain('resume_run');
            expect(message).not.toContain('token=');
        } finally {
            await engine.stop();
        }
    });

    it('needs the OpenClaw settings', () => {
        stubEnv();
        vi.stubEnv('OPENCLAW_TO', '');
        expect(() => createApprovalEngine(approvalModel('deploy'))).toThrow('OPENCLAW_TO');
    });
});
