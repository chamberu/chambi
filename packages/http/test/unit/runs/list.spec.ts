/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { defineAgent } from '@chamvi/core';
import { http } from '@chamvi/http';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunTestApp,
    createTestApp,
    tokenFor,
} from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

async function setup() {
    const ctx = createRunTestApp();
    const ids: string[] = [];

    for (const agent of ['echo', 'gate', 'echo']) {
        const response = await call(ctx.app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN });

        ids.push((await response.json() as { runId: string }).runId);
        ctx.clock.advance(1);
    }

    return { ...ctx, ids };
}

type ListBody = {
    data: Array<Record<string, unknown>>;
    meta: {
        total: number;
        limit: number;
        offset: number
    }
};

describe('GET /runs', () => {
    it('filters by agent and leaves out the claim', async () => {
        const { app, ids } = await setup();
        const response = await call(app, 'GET', '/runs?filter[agent]=echo', { token: READER_TOKEN });

        expect(response.status).toBe(200);

        const body = await response.json() as ListBody;

        expect(body.meta).toEqual({
            total: 2,
            limit: 50,
            offset: 0,
        });
        expect(body.data.map((run) => run.id)).toEqual([ids[0], ids[2]]);

        for (const run of body.data) {
            expect(run).not.toHaveProperty('claim');
        }
    });

    it('pages by createdAt', async () => {
        const { app, ids } = await setup();
        const body = await (await call(app, 'GET', '/runs?page[limit]=1&page[offset]=1', { token: READER_TOKEN })).json() as ListBody;

        expect(body.data.map((run) => run.id)).toEqual([ids[1]]);
        expect(body.meta).toEqual({
            total: 3,
            limit: 1,
            offset: 1,
        });
    });

    it('GET /runs?sort=-createdAt lists newest first', async () => {
        const { app, ids } = await setup();
        const body = await (await call(app, 'GET', '/runs?sort=-createdAt', { token: READER_TOKEN })).json() as ListBody;

        expect(body.data.map((run) => run.id)).toEqual([ids[2], ids[1], ids[0]]);

        const page = await (await call(app, 'GET', '/runs?sort=-createdAt&page[limit]=1&page[offset]=1', { token: READER_TOKEN })).json() as ListBody;

        expect(page.data.map((run) => run.id)).toEqual([ids[1]]);
        expect(page.meta.total).toBe(3);
    });

    it('accepts percent-encoded brackets', async () => {
        const { app } = await setup();
        const body = await (await call(app, 'GET', '/runs?filter%5Bagent%5D=echo', { token: READER_TOKEN })).json() as ListBody;

        expect(body.meta.total).toBe(2);
    });

    it('lets a principal filter to an agent named like a number', async () => {
        const { app } = createTestApp({
            agents: [defineAgent({
                name: '007',
                model: textModel(),
                instructions: 'Count.',
                channels: [http.on()],
            })],
        });
        const token = tokenFor('agent:007:run');

        expect((await call(app, 'POST', '/agents/007/runs', { token })).status).toBe(202);

        for (const query of ['filter[agent]=007', 'filter=eq(agent,\'007\')']) {
            const response = await call(app, 'GET', `/runs?${query}`, { token });

            expect(response.status).toBe(200);
            expect((await response.json() as ListBody).meta.total).toBe(1);
        }
    });

    it('lets run:read list without a filter', async () => {
        const { app } = await setup();

        expect((await call(app, 'GET', '/runs', { token: READER_TOKEN })).status).toBe(200);
    });

    it('needs a filter to a runnable agent without run:read', async () => {
        const { app } = await setup();
        const token = tokenFor('agent:echo:run');
        const denied = await call(app, 'GET', '/runs', { token });

        expect(denied.status).toBe(403);
        expect((await denied.json()).message).toBe('Missing permission "run:read".');
        expect((await call(app, 'GET', '/runs?filter[agent]=echo', { token })).status).toBe(200);
        expect((await call(app, 'GET', '/runs?filter[agent]=gate', { token })).status).toBe(403);
        expect((await call(app, 'GET', '/runs')).status).toBe(401);
    });

    it('answers 400 JSON with issues for a rejected query', async () => {
        const { app } = await setup();
        const response = await call(app, 'GET', '/runs?filter[nope]=1', { token: READER_TOKEN });

        expect(response.status).toBe(400);

        const body = await response.json();

        expect(body.code).toBe('bad_request');
        expect(body.issues.length).toBeGreaterThan(0);
    });
});
