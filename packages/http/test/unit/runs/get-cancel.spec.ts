/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunTestApp,
    tokenFor,
} from '../../utils/app.ts';

async function start(app: ReturnType<typeof createRunTestApp>['app'], agent: string): Promise<string> {
    const response = await call(app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN });

    return (await response.json() as { runId: string }).runId;
}

describe('GET /runs/:id', () => {
    it('returns the run with its steps and without its claim', async () => {
        const { app, engine } = createRunTestApp();
        const runId = await start(app, 'echo');

        await engine.start();
        await engine.idle();

        const response = await call(app, 'GET', `/runs/${runId}`, { token: READER_TOKEN });

        expect(response.status).toBe(200);

        const body = await response.json();

        expect(body.status).toBe('completed');
        expect(body.steps.length).toBeGreaterThan(0);
        expect(body).not.toHaveProperty('claim');
        await engine.drain();
    });

    it('answers 404 for a missing run', async () => {
        const { app } = createRunTestApp();

        expect((await call(app, 'GET', '/runs/missing', { token: ADMIN_TOKEN })).status).toBe(404);
    });

    it('lets agent:<agent>:run read that agent\'s runs only', async () => {
        const { app } = createRunTestApp();
        const echo = await start(app, 'echo');
        const gate = await start(app, 'gate');
        const token = tokenFor('agent:echo:run');

        expect((await call(app, 'GET', `/runs/${echo}`, { token })).status).toBe(200);

        const denied = await call(app, 'GET', `/runs/${gate}`, { token });

        expect(denied.status).toBe(403);
        expect((await denied.json()).message).toBe('Missing permission "run:read".');
    });

    it('lets run:read read every run and nothing else read any', async () => {
        const { app } = createRunTestApp();
        const echo = await start(app, 'echo');
        const gate = await start(app, 'gate');

        expect((await call(app, 'GET', `/runs/${echo}`, { token: READER_TOKEN })).status).toBe(200);
        expect((await call(app, 'GET', `/runs/${gate}`, { token: READER_TOKEN })).status).toBe(200);
        expect((await call(app, 'GET', `/runs/${echo}`, { token: tokenFor() })).status).toBe(403);
        expect((await call(app, 'GET', `/runs/${echo}`)).status).toBe(401);
    });
});

describe('POST /runs/:id/cancel', () => {
    it('cancels a queued run, then answers 409', async () => {
        const { app } = createRunTestApp();
        const runId = await start(app, 'echo');
        const response = await call(app, 'POST', `/runs/${runId}/cancel`, { token: ADMIN_TOKEN });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ runId, status: 'cancelled' });

        const again = await call(app, 'POST', `/runs/${runId}/cancel`, { token: ADMIN_TOKEN });

        expect(again.status).toBe(409);
        expect((await again.json()).code).toBe('invalid_run_state');
    });

    it('answers 404 for a missing run', async () => {
        const { app } = createRunTestApp();

        expect((await call(app, 'POST', '/runs/missing/cancel', { token: ADMIN_TOKEN })).status).toBe(404);
    });

    it('needs run:cancel', async () => {
        const { app } = createRunTestApp();
        const runId = await start(app, 'echo');

        expect((await call(app, 'POST', `/runs/${runId}/cancel`, { token: READER_TOKEN })).status).toBe(403);
    });
});
