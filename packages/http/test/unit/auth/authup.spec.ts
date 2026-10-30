/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ITokenVerifier, TokenVerificationData } from '@authup/server-adapter-kit';
import { describe, expect, it } from 'vitest';
import { authup } from '@chamvi/http';

function verifierFor(data: TokenVerificationData): ITokenVerifier {
    return {
        verify: async (token) => {
            if (token === 'good') {
                return data;
            }

            throw new Error('invalid_token');
        },
    };
}

const PERMISSIONS = [{ name: 'agent:triage:run' }, { name: 'run:read' }];

const request = (authorization?: string) => new Request('http://test', { headers: authorization ? { authorization } : {} });

const withScope = (scope: string | undefined) => authup({
    verifier: verifierFor({
        sub: 'u1',
        ...(scope === undefined ? {} : { scope }),
        permissions: PERMISSIONS,
    }),
});

describe('authup', () => {
    it('grants the permissions of a global token', async () => {
        const principal = await withScope('global')(request('Bearer good'));

        expect(principal).toMatchObject({
            id: 'u1',
            kind: 'authup',
            permissions: ['agent:triage:run', 'run:read'],
        });
        expect(principal?.claims?.sub).toBe('u1');
    });

    it.each([['openid email'], [undefined], ['globally']])('keeps the identity but grants nothing for scope %j', async (scope) => {
        const principal = await withScope(scope)(request('Bearer good'));

        expect(principal).toMatchObject({ id: 'u1', permissions: [] });
    });

    it('resolves undefined without a header', async () => {
        expect(await withScope('global')(request())).toBeUndefined();
    });

    it('rejects a token the verifier rejects with 401', async () => {
        await expect(withScope('global')(request('Bearer bad'))).rejects.toMatchObject({
            status: 401,
            message: 'The access token is invalid.',
        });
    });

    it.each([[undefined], ['']])('rejects a verified token with sub %j with 401', async (sub) => {
        const data = {
            scope: 'global',
            permissions: PERMISSIONS,
            ...(sub === undefined ? {} : { sub }),
        } as TokenVerificationData;

        await expect(authup({ verifier: verifierFor(data) })(request('Bearer good'))).rejects.toMatchObject({
            status: 401,
            message: 'The access token names no subject.',
        });
    });

    it('rejects a malformed header with 401', async () => {
        await expect(withScope('global')(request('Bearer'))).rejects.toMatchObject({ status: 401 });
    });
});
