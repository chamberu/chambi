/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { readBearerToken } from '../helpers.ts';
import type { Authenticator, Principal } from '../types.ts';
import { STATIC_TOKEN_MIN_LENGTH } from './constants.ts';
import { hashToken } from './helpers.ts';
import type { StaticTokensOptions } from './types.ts';

/**
 * Bearer tokens configured up front (CI, OpenClaw). Tokens are looked up by
 * their SHA-256, never compared as strings. An unknown token resolves
 * `undefined`, so the chain continues.
 */
export function staticTokens(options: StaticTokensOptions): Authenticator {
    const { tokens } = options;

    if (!Array.isArray(tokens) || tokens.length === 0) {
        throw new InvalidAgentDefinitionError('staticTokens() needs a non-empty array of tokens.');
    }

    const principals = new Map<string, Principal>();

    for (const {
        value,
        id,
        permissions,
    } of tokens) {
        if (typeof id !== 'string' || id.length === 0) {
            throw new InvalidAgentDefinitionError('Every static token needs a non-empty id.');
        }

        if (typeof value !== 'string' || value.length < STATIC_TOKEN_MIN_LENGTH) {
            throw new InvalidAgentDefinitionError(
                `The static token of "${id}" must have at least ${STATIC_TOKEN_MIN_LENGTH} characters.`,
            );
        }

        const digest = hashToken(value);

        if (principals.has(digest)) {
            // a later entry would silently take over the earlier one's grants
            throw new InvalidAgentDefinitionError(`The static token of "${id}" is given more than once.`);
        }

        principals.set(digest, {
            id,
            kind: 'token',
            permissions: [...permissions],
        });
    }

    return async (request) => {
        const token = readBearerToken(request);

        if (token === undefined) {
            return undefined;
        }

        const principal = principals.get(hashToken(token));

        return principal ? { ...principal, permissions: [...principal.permissions] } : undefined;
    };
}
