/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { verifyRequest } from '@authup/server-adapter-web';
import { UnauthorizedError } from '@ebec/http';
import type { Authenticator } from '../types.ts';
import type { AuthupOptions } from './types.ts';

function grantsGlobal(scope: unknown): boolean {
    return typeof scope === 'string' && scope.split(' ').includes('global');
}

/**
 * Verifies authup access tokens. Grants are read only from tokens with the
 * `global` scope; any other token keeps its identity and grants nothing.
 * Permission `policies`, `realm_id` and `client_id` are not evaluated. In
 * local mode authup yields no permissions: grants need remote mode.
 */
export function authup(options: AuthupOptions): Authenticator {
    return async (request) => {
        let data;

        try {
            data = await verifyRequest(request, {
                tokenVerifier: options.verifier,
                certificateThumbprintByRequest: options.certificateThumbprintByRequest,
            });
        } catch (cause) {
            throw new UnauthorizedError({ message: 'The access token is invalid.', cause });
        }

        if (!data) {
            return undefined;
        }

        if (typeof data.sub !== 'string' || data.sub.length === 0) {
            throw new UnauthorizedError({ message: 'The access token names no subject.' });
        }

        return {
            id: data.sub,
            kind: 'authup',
            permissions: grantsGlobal(data.scope) ? data.permissions.map((p) => p.name) : [],
            claims: { ...data },
        };
    };
}
