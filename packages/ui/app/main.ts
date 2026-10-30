/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { addCollection } from '@iconify/vue';
import installButton from '@vuecs/button';
import vuecs from '@vuecs/core';
import installCountdown from '@vuecs/countdown';
import installElements from '@vuecs/elements';
import installForms from '@vuecs/forms';
import installIcon from '@vuecs/icon';
import lucide from '@vuecs/icons-lucide';
import installOverlays from '@vuecs/overlays';
import installPagination from '@vuecs/pagination';
import installPlaceholder from '@vuecs/placeholder';
import installTable from '@vuecs/table';
import tailwind from '@vuecs/theme-tailwind';
import installTimeago from '@vuecs/timeago';
import { createApp } from 'vue';
import App from './App.vue';
import { createApiClient } from './api/module.ts';
import type { IApiClient } from './api/types.ts';
import { createAuthGuard } from './auth/guard.ts';
import { createSession } from './auth/module.ts';
import type { IAuthupAdapter } from './auth/types.ts';
import { readConfig } from './config/module.ts';
import { APP_CONTEXT } from './context/constants.ts';
import { RouteName } from './router/constants.ts';
import { createUiRouter } from './router/module.ts';
import icons from 'virtual:chamvi-icons';
import './style.css';

// icons from the bundle, never fetched (CSP connect-src 'self')
addCollection(icons);

const config = readConfig(document);
const app = createApp(App);

// the authup kit (and its pinia) must be installed before vuecs
let adapter: IAuthupAdapter | undefined;

if (config.auth.authup) {
    const { createAuthupAdapter } = await import('./auth/authup.ts');

    adapter = createAuthupAdapter(app, config.auth.authup, config.uiBase);
}

app.use(vuecs, { themes: [tailwind()], icons: [lucide()] });

for (const plugin of [
    installIcon,
    installButton,
    installCountdown,
    installElements,
    installForms,
    installOverlays,
    installPagination,
    installPlaceholder,
    installTable,
    installTimeago,
]) {
    app.use(plugin);
}

let client: IApiClient;
const session = createSession(config, {
    storage: window.sessionStorage,
    client: () => client,
    ...(adapter ? { authup: async () => adapter } : {}),
});
const router = createUiRouter(config, [createAuthGuard(session)]);

client = createApiClient({
    apiBase: config.apiBase,
    token: () => session.token(),
    refresh: () => session.refresh(),
    onUnauthorized: () => {
        const current = router.currentRoute.value;

        if (current.meta.public === true) {
            return;
        }

        void session.signOut().then(() => router.replace({ name: RouteName.LOGIN, query: { redirect: current.fullPath } }));
    },
});

app.provide(APP_CONTEXT, {
    config,
    client,
    session,
    storage: window.sessionStorage,
});
app.use(router);
app.mount('#app');
