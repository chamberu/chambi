/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { UnauthorizedError } from '@ebec/http';
import { App, defineCoreHandler } from 'routup';
import { describe, expect, it } from 'vitest';
import { staticTokens } from '@chamvi/http';
import type { Authenticator, Principal } from '@chamvi/http';
import { buildContext, createErrorHandler } from '../../../src/app/helpers.ts';
import { authorize } from '../../../src/auth/helpers.ts';
import { READER_TOKEN, createTestApp } from '../../utils/app.ts';

const reader = staticTokens({
    tokens: [{
        value: READER_TOKEN,
        id: 'reader',
        permissions: ['run:read'],
    }],
});

const throwing: Authenticator = async () => {
    throw new UnauthorizedError({ message: 'rejected by the first authenticator' });
};

function probeApp(auth: Authenticator[]) {
    const { engine } = createTestApp();
    const ctx = buildContext({ engine, auth });
    const app = new App();

    app.get('/probe', defineCoreHandler(async (event) => {
        const permission = event.searchParams.get('p') ?? undefined;

        await authorize(event, ctx, permission);

        const principal = await authorize(event, ctx, permission);

        return { id: principal.id };
    }));
    app.use(createErrorHandler(ctx));

    return app;
}

const probe = (app: App, token?: string, permission?: string) => app.fetch(new Request(
    `http://test/probe${permission ? `?p=${permission}` : ''}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
));

describe('authorize', () => {
    it('answers 401 with WWW-Authenticate without a token', async () => {
        const response = await probe(probeApp([reader]));

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(await response.json()).toMatchObject({ message: 'Authentication required.' });
    });

    it('lets a known token through', async () => {
        const response = await probe(probeApp([reader]), READER_TOKEN, 'run:read');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ id: 'reader' });
    });

    it('answers 403 for a missing permission', async () => {
        const response = await probe(probeApp([reader]), READER_TOKEN, 'run:cancel');

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ message: 'Missing permission "run:cancel".' });
    });

    it('skips an authenticator that throws when a later one resolves', async () => {
        const response = await probe(probeApp([throwing, reader]), READER_TOKEN);

        expect(response.status).toBe(200);
    });

    it('answers the remembered error when nothing resolves', async () => {
        const response = await probe(probeApp([throwing]), READER_TOKEN);

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(await response.json()).toMatchObject({ message: 'rejected by the first authenticator' });
    });

    it.each([
        ['an empty id', {
            id: '',
            kind: 'custom',
            permissions: [],
        }],
        ['no kind', { id: 'x', permissions: [] }],
        ['an empty kind', {
            id: 'x',
            kind: '',
            permissions: [],
        }],
        ['permissions that are no array', {
            id: 'x',
            kind: 'custom',
            permissions: 'run:read',
        }],
        ['a non-string permission', {
            id: 'x',
            kind: 'custom',
            permissions: [42],
        }],
    ])('answers 500 for an authenticator resolving a principal with %s, without trying the next one', async (_name, principal) => {
        let later = 0;
        const malformed: Authenticator = async () => principal as unknown as Principal;
        const next: Authenticator = async (request) => {
            later++;

            return reader(request);
        };
        const response = await probe(probeApp([malformed, next]), READER_TOKEN);

        expect(response.status).toBe(500);
        expect(later).toBe(0);
    });

    it('runs the chain once per request', async () => {
        let calls = 0;
        const counting: Authenticator = async (request) => {
            calls++;

            return reader(request);
        };
        const response = await probe(probeApp([counting]), READER_TOKEN);

        expect(response.status).toBe(200);
        expect(calls).toBe(1);
    });
});
