/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { shallowRef } from 'vue';
import { ApiError } from '../api/error.ts';
import type { MeWire } from '../api/types.ts';
import type { UiConfig } from '../../src/config/types.ts';
import { RETURN_STORAGE_KEY, TOKEN_STORAGE_KEY } from './constants.ts';
import { clearStorage, safeReturnPath } from './helpers.ts';
import type {
    IAuthupAdapter,
    ISession,
    SessionDeps,
    SessionMethod,
} from './types.ts';

/**
 * Who is signed in, and with which credential: a pasted static token (kept
 * in `sessionStorage` once `GET /me` accepted it) or an authup session.
 * Every credential check passes the token to `me()` explicitly, so a
 * refused one never triggers the client's sign-out.
 */
export function createSession(config: UiConfig, deps: SessionDeps): ISession {
    const principal = shallowRef<MeWire | undefined>();
    let method: SessionMethod | undefined;
    let adapter: Promise<IAuthupAdapter> | undefined;

    const authup = (): Promise<IAuthupAdapter> => {
        if (!config.auth.authup || !deps.authup) {
            return Promise.reject(new Error('authup sign-in is not configured.'));
        }

        adapter ??= deps.authup();

        return adapter;
    };

    const session: ISession = {
        principal,
        get method() {
            return method;
        },
        async token() {
            if (method === 'authup') {
                return (await authup()).token();
            }

            return deps.storage.getItem(TOKEN_STORAGE_KEY) ?? undefined;
        },
        async refresh() {
            if (method !== 'authup') {
                return false;
            }

            return (await authup()).refresh();
        },
        async restore() {
            const stored = deps.storage.getItem(TOKEN_STORAGE_KEY);

            if (stored) {
                try {
                    principal.value = await client().me(stored);
                    method = 'token';

                    return true;
                } catch (e) {
                    // only a refused token goes: a network error, a 503
                    // while the server drains or a 429 keeps it, and the
                    // next navigation tries again
                    if (e instanceof ApiError && e.status === 401) {
                        deps.storage.removeItem(TOKEN_STORAGE_KEY);
                    } else {
                        principal.value = undefined;
                        method = undefined;

                        return false;
                    }
                }
            }

            if (config.auth.authup && deps.authup) {
                try {
                    const token = await (await authup()).token();

                    if (token) {
                        principal.value = await client().me(token);
                        method = 'authup';

                        return true;
                    }
                } catch {
                    // an expired or revoked authup session: sign in again
                }
            }

            principal.value = undefined;
            method = undefined;

            return false;
        },
        async signInWithToken(token) {
            const me = await client().me(token);

            deps.storage.setItem(TOKEN_STORAGE_KEY, token);
            principal.value = me;
            method = 'token';
        },
        async startAuthup(returnTo) {
            const flow = await authup();

            deps.storage.setItem(RETURN_STORAGE_KEY, safeReturnPath(returnTo));

            const url = await flow.start();

            (deps.navigate ?? ((target: string) => window.location.assign(target)))(url);
        },
        async completeAuthup(query) {
            if (!query.code) {
                throw new Error('The sign-in callback has no code.');
            }

            if (!query.state) {
                throw new Error('The sign-in callback has no state.');
            }

            const flow = await authup();

            await flow.complete(query.code, query.state);

            const token = await flow.token();

            if (!token) {
                throw new Error('authup answered no access token.');
            }

            principal.value = await client().me(token);
            method = 'authup';

            const returnTo = safeReturnPath(deps.storage.getItem(RETURN_STORAGE_KEY));

            deps.storage.removeItem(RETURN_STORAGE_KEY);

            return returnTo;
        },
        async signOut() {
            const wasAuthup = method === 'authup' || adapter !== undefined;

            clearStorage(deps.storage);
            principal.value = undefined;
            method = undefined;

            if (wasAuthup) {
                try {
                    await (await authup()).signOut();
                } catch {
                    // the local session is gone either way
                }
            }
        },
    };

    let api: ReturnType<SessionDeps['client']> | undefined;
    function client() {
        api ??= deps.client(session);

        return api;
    }

    return session;
}
