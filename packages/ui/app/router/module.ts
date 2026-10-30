/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createRouter, createWebHistory } from 'vue-router';
import type { NavigationGuard, Router, RouterHistory } from 'vue-router';
import type { UiConfig } from '../../src/config/types.ts';
import { RouteName } from './constants.ts';

/**
 * The dashboard's router under `config.uiBase`; `guards` run as global
 * `beforeEach` guards in the given order (the deep-link token strip
 * first, then the auth guard). Views load lazily.
 */
export function createUiRouter(config: UiConfig, guards: NavigationGuard[] = [], history?: RouterHistory): Router {
    const router = createRouter({
        history: history ?? createWebHistory(config.uiBase),
        routes: [
            {
                path: '/login',
                name: RouteName.LOGIN,
                component: () => import('../views/LoginView.vue'),
                meta: { public: true },
            },
            {
                path: '/login/callback',
                name: RouteName.LOGIN_CALLBACK,
                component: () => import('../views/LoginCallbackView.vue'),
                meta: { public: true },
            },
            { path: '/', redirect: { name: RouteName.AGENTS } },
            {
                path: '/runs',
                name: RouteName.RUNS,
                component: () => import('../views/RunsView.vue'),
            },
            {
                path: '/agents',
                name: RouteName.AGENTS,
                component: () => import('../views/AgentsView.vue'),
            },
            {
                path: '/agents/:name',
                name: RouteName.AGENT,
                component: () => import('../views/AgentView.vue'),
            },
            {
                path: '/runs/:id',
                name: RouteName.RUN,
                component: () => import('../views/RunView.vue'),
            },
            {
                path: '/approvals',
                name: RouteName.APPROVALS,
                component: () => import('../views/ApprovalsView.vue'),
            },
            {
                path: '/schedules',
                name: RouteName.SCHEDULES,
                component: () => import('../views/SchedulesView.vue'),
            },
            { path: '/:rest(.*)*', redirect: { name: RouteName.AGENTS } },
        ],
    });

    for (const guard of guards) {
        router.beforeEach(guard);
    }

    return router;
}
