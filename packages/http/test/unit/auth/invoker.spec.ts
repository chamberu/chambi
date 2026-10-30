/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { toInvoker } from '../../../src/auth/helpers.ts';

describe('toInvoker', () => {
    it('keeps id, kind and a copy of the permissions, never the claims', () => {
        const permissions = ['run:read'];
        const invoker = toInvoker({
            id: 'u1',
            kind: 'oidc',
            permissions,
            claims: { sub: 'u1', secret: 'x' },
        });

        expect(invoker).toEqual({
            id: 'u1',
            kind: 'oidc',
            permissions: ['run:read'],
        });
        expect(invoker.permissions).not.toBe(permissions);
    });

    it('takes the name from name, then preferred_username, never email', () => {
        const base = {
            id: 'u1',
            kind: 'authup',
            permissions: [],
        };

        expect(toInvoker({
            ...base,
            claims: {
                name: 'Alice',
                preferred_username: 'alice',
                email: 'a@x',
            },
        }).name).toBe('Alice');
        expect(toInvoker({ ...base, claims: { preferred_username: 'alice', email: 'a@x' } }).name).toBe('alice');
        expect(toInvoker({ ...base, claims: { email: 'a@x' } })).not.toHaveProperty('name');
        expect(toInvoker({
            ...base,
            claims: {
                name: '',
                preferred_username: 42,
                email: 'a@x',
            },
        })).not.toHaveProperty('name');
        expect(toInvoker({ ...base, claims: {} })).not.toHaveProperty('name');
    });

    it('has no name for a principal without claims (static tokens)', () => {
        expect(toInvoker({
            id: 'ci',
            kind: 'token',
            permissions: ['*'],
        })).toEqual({
            id: 'ci',
            kind: 'token',
            permissions: ['*'],
        });
    });
});
