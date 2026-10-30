/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createAuthGuard } from '../../../../app/auth/guard.ts';
import { TOKEN_STORAGE_KEY } from '../../../../app/auth/constants.ts';
import { createSession } from '../../../../app/auth/module.ts';
import { DEV_CONFIG } from '../../../../app/config/constants.ts';
import { RouteName } from '../../../../app/router/constants.ts';
import { createUiRouter } from '../../../../app/router/module.ts';
import {
    ME,
    apiError,
    fakeClient,
    meFor,
} from '../../../utils/client.ts';
import { MemoryStorage } from '../../../utils/storage.ts';

function setup(storage = new MemoryStorage()) {
    let meCalls = 0;
    const me = meFor('good');
    const session = createSession(DEV_CONFIG, {
        storage,
        client: () => fakeClient({
            me: async (token) => {
                meCalls++;

                return me(token);
            },
        }),
    });
    const router = createUiRouter(DEV_CONFIG, [createAuthGuard(session)], createMemoryHistory('/ui'));

    return {
        router,
        session,
        meCalls: () => meCalls,
    };
}

describe('auth guard', () => {
    it('sends an unauthenticated visit to login with the return path', async () => {
        const { router } = setup();

        await router.push('/runs/abc?x=1');
        expect(router.currentRoute.value.name).toBe(RouteName.LOGIN);
        expect(router.currentRoute.value.query.redirect).toBe('/runs/abc?x=1');
    });

    it('lets a public route through', async () => {
        const { router } = setup();

        await router.push('/login/callback?code=c&state=s');
        expect(router.currentRoute.value.name).toBe(RouteName.LOGIN_CALLBACK);
    });

    it('lets a signed-in principal through', async () => {
        const { router, session } = setup();

        await session.signInWithToken('good');
        await router.push('/schedules');
        expect(router.currentRoute.value.name).toBe(RouteName.SCHEDULES);
    });

    it('restores once on the first navigation', async () => {
        const storage = new MemoryStorage();

        storage.setItem(TOKEN_STORAGE_KEY, 'good');

        const { router, meCalls } = setup(storage);

        await router.push('/schedules');
        await router.push('/approvals');
        await router.push('/runs');
        expect(router.currentRoute.value.name).toBe(RouteName.RUNS);
        expect(meCalls()).toBe(1);
    });

    it('restores again on the next navigation after the server was unreachable', async () => {
        const storage = new MemoryStorage();

        storage.setItem(TOKEN_STORAGE_KEY, 'good');

        let up = false;
        const session = createSession(DEV_CONFIG, {
            storage,
            client: () => fakeClient({
                me: async () => {
                    if (!up) {
                        throw apiError(503, 'service_unavailable');
                    }

                    return ME;
                },
            }),
        });
        const router = createUiRouter(DEV_CONFIG, [createAuthGuard(session)], createMemoryHistory('/ui'));

        await router.push('/schedules');
        expect(router.currentRoute.value.name).toBe(RouteName.LOGIN);
        expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('good');
        up = true;
        await router.push('/schedules');
        expect(router.currentRoute.value.name).toBe(RouteName.SCHEDULES);
    });
});
