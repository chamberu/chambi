/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { call, createTestApp } from '../../utils/app.ts';

describe('GET /healthz', () => {
    it('answers ok without a token', async () => {
        const { app } = createTestApp();
        const response = await call(app, 'GET', '/healthz');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('moves under basePath', async () => {
        const { app } = createTestApp({ basePath: '/api' });

        expect((await call(app, 'GET', '/api/healthz')).status).toBe(200);
        expect((await call(app, 'GET', '/healthz')).status).toBe(404);
    });
});
