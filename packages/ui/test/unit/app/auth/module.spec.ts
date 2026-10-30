/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../app/api/error.ts';
import { RETURN_STORAGE_KEY, TOKEN_STORAGE_KEY } from '../../../../app/auth/constants.ts';
import { createSession } from '../../../../app/auth/module.ts';
import type { IAuthupAdapter } from '../../../../app/auth/types.ts';
import { DEV_CONFIG } from '../../../../app/config/constants.ts';
import type { UiConfig } from '../../../../src/config/types.ts';
import {
    ME,
    apiError,
    fakeClient,
    meFor,
} from '../../../utils/client.ts';
import { MemoryStorage } from '../../../utils/storage.ts';

const AUTHUP_CONFIG: UiConfig = {
    ...DEV_CONFIG,
    auth: { tokens: true, authup: { url: 'https://auth.example.com', clientId: 'chamvi' } },
};

function fakeAdapter(token?: string) {
    const calls: string[] = [];
    const adapter: IAuthupAdapter & { calls: string[]; token(): Promise<string | undefined> } = {
        calls,
        start: async () => {
            calls.push('start');

            return 'https://auth.example.com/authorize?x=1';
        },
        complete: async (code, state) => {
            calls.push(`complete:${code}:${state}`);
            token = 'authup-token';
        },
        token: async () => token,
        refresh: async () => {
            calls.push('refresh');

            return false;
        },
        signOut: async () => {
            calls.push('signOut');
            token = undefined;
        },
    };

    return adapter;
}

describe('createSession', () => {
    it('signInWithToken stores the token only after me() accepted it', async () => {
        const storage = new MemoryStorage();
        const session = createSession(DEV_CONFIG, { storage, client: () => fakeClient({ me: meFor('good') }) });

        await session.signInWithToken('good');
        expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('good');
        expect(session.principal.value).toEqual(ME);
        expect(session.method).toBe('token');
        expect(await session.token()).toBe('good');
    });

    it('signInWithToken with a refused token stores nothing and throws', async () => {
        const storage = new MemoryStorage();
        const session = createSession(DEV_CONFIG, { storage, client: () => fakeClient({ me: meFor('good') }) });

        await expect(session.signInWithToken('bad')).rejects.toBeInstanceOf(ApiError);
        expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
        expect(session.principal.value).toBeUndefined();
    });

    it('restore uses the stored token', async () => {
        const storage = new MemoryStorage();

        storage.setItem(TOKEN_STORAGE_KEY, 'good');

        const session = createSession(DEV_CONFIG, { storage, client: () => fakeClient({ me: meFor('good') }) });

        expect(await session.restore()).toBe(true);
        expect(session.principal.value).toEqual(ME);
    });

    it('restore is false and clears a token me() refuses', async () => {
        const storage = new MemoryStorage();

        storage.setItem(TOKEN_STORAGE_KEY, 'revoked');

        const session = createSession(DEV_CONFIG, { storage, client: () => fakeClient({ me: meFor('good') }) });

        expect(await session.restore()).toBe(false);
        expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
        expect(session.principal.value).toBeUndefined();
    });

    it('restore keeps the stored token when me() fails with anything but 401', async () => {
        for (const error of [apiError(503, 'service_unavailable'), apiError(429, 'too_many_requests'), new TypeError('fetch failed')]) {
            const storage = new MemoryStorage();

            storage.setItem(TOKEN_STORAGE_KEY, 'good');

            const session = createSession(DEV_CONFIG, {
                storage,
                client: () => fakeClient({
                    me: async () => {
                        throw error;
                    },
                }),
            });

            expect(await session.restore()).toBe(false);
            expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('good');
            expect(session.principal.value).toBeUndefined();
        }
    });

    it('restore is false without any credential', async () => {
        const session = createSession(DEV_CONFIG, { storage: new MemoryStorage(), client: () => fakeClient() });

        expect(await session.restore()).toBe(false);
    });

    it('restore uses the authup session', async () => {
        const adapter = fakeAdapter('authup-token');
        const session = createSession(AUTHUP_CONFIG, {
            storage: new MemoryStorage(),
            client: () => fakeClient({ me: meFor('authup-token') }),
            authup: async () => adapter,
        });

        expect(await session.restore()).toBe(true);
        expect(session.method).toBe('authup');
        expect(await session.token()).toBe('authup-token');
    });

    it('signOut clears token, principal and the authup session', async () => {
        const storage = new MemoryStorage();
        const adapter = fakeAdapter('authup-token');
        const session = createSession(AUTHUP_CONFIG, {
            storage,
            client: () => fakeClient({ me: meFor('authup-token') }),
            authup: async () => adapter,
        });

        await session.restore();
        storage.setItem(TOKEN_STORAGE_KEY, 'x');
        storage.setItem(RETURN_STORAGE_KEY, '/runs');
        storage.setItem('chamvi.authup.access_token', '"at"');
        storage.setItem('other', 'kept');
        await session.signOut();
        expect(storage.length).toBe(1);
        expect(storage.getItem('other')).toBe('kept');
        expect(session.principal.value).toBeUndefined();
        expect(session.method).toBeUndefined();
        expect(adapter.calls).toContain('signOut');
        expect(await session.token()).toBeUndefined();
    });

    it('refresh asks the authup adapter, never for a pasted token', async () => {
        const adapter = fakeAdapter('authup-token');
        const session = createSession(AUTHUP_CONFIG, {
            storage: new MemoryStorage(),
            client: () => fakeClient({ me: meFor('authup-token', 'good') }),
            authup: async () => adapter,
        });

        await session.signInWithToken('good');
        expect(await session.refresh()).toBe(false);
        expect(adapter.calls).not.toContain('refresh');
        await session.signOut();
        await session.restore();
        await session.refresh();
        expect(adapter.calls).toContain('refresh');
    });

    it('startAuthup keeps the return path and completeAuthup hands it back', async () => {
        const storage = new MemoryStorage();
        const adapter = fakeAdapter();
        const visited: string[] = [];
        const session = createSession(AUTHUP_CONFIG, {
            storage,
            client: () => fakeClient({ me: meFor('authup-token') }),
            authup: async () => adapter,
            navigate: (url) => {
                visited.push(url);
            },
        });

        await session.startAuthup('/approvals?x=1');
        expect(storage.getItem(RETURN_STORAGE_KEY)).toBe('/approvals?x=1');
        expect(visited).toEqual(['https://auth.example.com/authorize?x=1']);

        expect(await session.completeAuthup({ code: 'c', state: 's' })).toBe('/approvals?x=1');
        expect(adapter.calls).toContain('complete:c:s');
        expect(storage.getItem(RETURN_STORAGE_KEY)).toBeNull();
        expect(session.principal.value).toEqual(ME);
        expect(session.method).toBe('authup');
    });

    it('completeAuthup returns / without a usable return path', async () => {
        const storage = new MemoryStorage();

        storage.setItem(RETURN_STORAGE_KEY, '//evil.example.com');

        const session = createSession(AUTHUP_CONFIG, {
            storage,
            client: () => fakeClient({ me: meFor('authup-token') }),
            authup: async () => fakeAdapter(),
        });

        expect(await session.completeAuthup({ code: 'c', state: 's' })).toBe('/');
    });

    it('completeAuthup rejects a missing code or state', async () => {
        const session = createSession(AUTHUP_CONFIG, {
            storage: new MemoryStorage(),
            client: () => fakeClient(),
            authup: async () => fakeAdapter(),
        });

        await expect(session.completeAuthup({ state: 's' })).rejects.toThrow(/code/);
        await expect(session.completeAuthup({ code: 'c' })).rejects.toThrow(/state/);
    });

    it('startAuthup without authup configured rejects', async () => {
        const session = createSession(DEV_CONFIG, { storage: new MemoryStorage(), client: () => fakeClient() });

        await expect(session.startAuthup('/')).rejects.toThrow(/authup/);
    });
});
