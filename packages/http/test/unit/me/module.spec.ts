/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    READER_TOKEN,
    call,
    createTestApp,
    tokenFor,
} from '../../utils/app.ts';

describe('GET /me', () => {
    it('answers the principal\'s own id, kind and permissions', async () => {
        const { app } = createTestApp();
        const response = await call(app, 'GET', '/me', { token: READER_TOKEN });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: 'reader',
            kind: 'token',
            permissions: ['run:read'],
        });
    });

    it('needs no permission', async () => {
        const { app } = createTestApp();
        const response = await call(app, 'GET', '/me', { token: tokenFor() });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: 'p:',
            kind: 'token',
            permissions: [],
        });
    });

    it('401 without credentials', async () => {
        const { app } = createTestApp();
        const response = await call(app, 'GET', '/me');

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
    });

    it('a route registered at /me is refused', () => {
        expect(() => createTestApp({
            routes: [{
                method: 'GET',
                path: '/me',
                handler: async () => ({ status: 200 }),
            }],
        })).toThrow(InvalidAgentDefinitionError);
    });
});
