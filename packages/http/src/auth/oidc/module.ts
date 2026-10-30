/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { UnauthorizedError } from '@ebec/http';
import { createVerifier } from 'vouchly';
import type { VerifyResult } from 'vouchly';
import { isPrincipal, readBearerToken } from '../helpers.ts';
import type { Authenticator } from '../types.ts';
import { mapVerifyError } from './helpers.ts';
import type { OidcOptions } from './types.ts';

/**
 * Verifies JWTs of other OIDC issuers (e.g. GitHub Actions) with vouchly.
 * A token of an issuer not listed, or no JWT at all, resolves `undefined`
 * so the chain continues; `principal` decides what a valid token grants.
 */
export function oidc(options: OidcOptions): Authenticator {
    if (typeof options.principal !== 'function') {
        throw new InvalidAgentDefinitionError('oidc() needs a principal function.');
    }

    if (!Array.isArray(options.issuers) || options.issuers.length === 0) {
        throw new InvalidAgentDefinitionError('oidc() needs at least one issuer.');
    }

    for (const issuer of options.issuers) {
        const audiences = Array.isArray(issuer.audience) ? issuer.audience : [issuer.audience];

        const hasInvalidAudience = audiences.length !== 0 &&
            audiences.some((audience) => typeof audience !== 'string' || audience.length === 0);

        if (audiences.length === 0 || hasInvalidAudience) {
            // vouchly skips the aud check without one
            throw new InvalidAgentDefinitionError(`oidc() issuer "${issuer.id}" needs an audience.`);
        }
    }

    const verifier = createVerifier({
        issuers: options.issuers,
        ...(options.cache !== undefined ? { cache: options.cache } : {}),
        ...(options.cacheNamespace !== undefined ? { cacheNamespace: options.cacheNamespace } : {}),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    });

    return async (request) => {
        const token = readBearerToken(request);

        if (token === undefined) {
            return undefined;
        }

        let result: VerifyResult;

        try {
            result = await verifier.verify(token);
        } catch (error) {
            return mapVerifyError(error);
        }

        const principal = await options.principal(result);

        if (!principal) {
            throw new UnauthorizedError({ message: 'The token is not allowed.' });
        }

        if (!isPrincipal(principal)) {
            // a server misconfiguration (500 and onError), not a client error
            throw new InvalidAgentDefinitionError(
                `The oidc() principal mapper of issuer "${result.issuer.id}" must return a non-empty id and kind and a permissions array of strings.`,
            );
        }

        return principal;
    };
}
