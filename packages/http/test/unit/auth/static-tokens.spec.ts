/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { staticTokens } from '@chamvi/http';

const TOKEN = 'ci-token-0123456789';
const ROTATED = 'ci-token-9876543210';

const request = (authorization?: string) => new Request('http://test', { headers: authorization ? { authorization } : {} });

describe('staticTokens', () => {
    const auth = staticTokens({
        tokens: [{
            value: TOKEN,
            id: 'ci',
            permissions: ['run:read'],
        }],
    });

    it('resolves the principal of a known token', async () => {
        expect(await auth(request(`Bearer ${TOKEN}`))).toEqual({
            id: 'ci',
            kind: 'token',
            permissions: ['run:read'],
        });
    });

    it('resolves undefined without a header or for an unknown token', async () => {
        expect(await auth(request())).toBeUndefined();
        expect(await auth(request('Bearer unknown-token-0123456789'))).toBeUndefined();
    });

    it('rejects another scheme with 401', async () => {
        await expect(auth(request('Basic abc'))).rejects.toMatchObject({ status: 401 });
    });

    it('resolves every token of a principal that holds several', async () => {
        const rotating = staticTokens({
            tokens: [
                {
                    value: TOKEN,
                    id: 'ci',
                    permissions: ['run:read'],
                },
                {
                    value: ROTATED,
                    id: 'ci',
                    permissions: ['run:read'],
                },
            ],
        });

        expect(await rotating(request(`Bearer ${TOKEN}`))).toMatchObject({ id: 'ci' });
        expect(await rotating(request(`Bearer ${ROTATED}`))).toMatchObject({ id: 'ci' });
    });

    it('rejects short tokens and an empty list', () => {
        expect(() => staticTokens({
            tokens: [{
                value: 'short',
                id: 'x',
                permissions: [],
            }],
        })).toThrow(InvalidAgentDefinitionError);
        expect(() => staticTokens({ tokens: [] })).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects tokens that are no array', () => {
        expect(() => staticTokens({ tokens: { [TOKEN]: { id: 'ci', permissions: [] } } as never })).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects a token without a string value', () => {
        expect(() => staticTokens({ tokens: [{ id: 'ci', permissions: [] } as never] })).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects a token without an id', () => {
        expect(() => staticTokens({
            tokens: [{
                value: TOKEN,
                id: '',
                permissions: [],
            }],
        })).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects a token value given twice', () => {
        expect(() => staticTokens({
            tokens: [
                {
                    value: TOKEN,
                    id: 'ci',
                    permissions: ['run:read'],
                },
                {
                    value: TOKEN,
                    id: 'admin',
                    permissions: ['*'],
                },
            ],
        })).toThrow(InvalidAgentDefinitionError);
    });
});
