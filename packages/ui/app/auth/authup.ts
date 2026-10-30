/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    buildAuthorizeURL,
    clearAuthorizationRequest,
    createPKCE,
    createState,
    injectStore,
    install,
    loadAuthorizationRequest,
    saveAuthorizationRequest,
} from '@authup/client-web-kit';
import { createPinia } from 'pinia';
import type { App } from 'vue';
import type { UiAuthupConfig } from '../../src/config/types.ts';
import { createSessionCookies } from './helpers.ts';
import type { IAuthupAdapter } from './types.ts';

/**
 * Installs `@authup/client-web-kit` (with its own pinia, before vuecs, as
 * the kit asks) and wraps its code flow with PKCE. The redirect URI is
 * `<origin><uiBase>/login/callback`. The kit keeps its tokens in the
 * tab's `storage` (`createSessionCookies`), never in `document.cookie`.
 */
export function createAuthupAdapter(
    app: App,
    config: UiAuthupConfig,
    uiBase: string,
    storage: Storage = window.sessionStorage,
): IAuthupAdapter {
    const pinia = createPinia();

    app.use(pinia);
    install(app, {
        baseURL: config.url,
        pinia,
        components: false,
        realtime: false,
        cookiePath: `${uiBase}/`,
        cookieSecure: window.location.protocol === 'https:',
        ...createSessionCookies(storage),
    });

    const store = injectStore(pinia, app);

    return {
        async start() {
            const pkce = await createPKCE();
            const state = createState();
            const redirectUri = `${window.location.origin}${uiBase}/login/callback`;

            saveAuthorizationRequest({
                state,
                code_verifier: pkce.code_verifier,
                redirect_uri: redirectUri,
                client_id: config.clientId,
                ...(config.realmId ? { realm_id: config.realmId } : {}),
            });

            return buildAuthorizeURL({
                baseURL: config.url,
                clientId: config.clientId,
                realmId: config.realmId,
                redirectUri,
                state,
                codeChallenge: pkce.code_challenge,
                codeChallengeMethod: pkce.code_challenge_method,
            });
        },
        async complete(code, state) {
            const request = loadAuthorizationRequest();

            clearAuthorizationRequest();

            if (!request || request.state !== state) {
                throw new Error('The sign-in state does not match; start again.');
            }

            await store.exchangeAuthorizationCode(code, {
                code_verifier: request.code_verifier,
                redirect_uri: request.redirect_uri,
                client_id: request.client_id,
                ...(request.realm_id ? { realm_id: request.realm_id } : {}),
            });
        },
        async token() {
            await store.resolve();

            return store.accessToken || undefined;
        },
        // true while a token is in place after resolve(), rotated or not: a
        // 401 that raced another refresh retries once with the current token,
        // and only a 401 on that retry signs out
        async refresh() {
            try {
                await store.resolve();
            } catch {
                return false;
            }

            return !!store.accessToken;
        },
        async signOut() {
            await store.logout();
        },
    };
}
