/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import type { NavigationGuard } from 'vue-router';
import { DEV_CONFIG } from '../../../../app/config/constants.ts';
import { RouteName } from '../../../../app/router/constants.ts';
import { createUiRouter } from '../../../../app/router/module.ts';

describe('createUiRouter', () => {
    it('resolves the named routes under uiBase', () => {
        const router = createUiRouter(DEV_CONFIG, [], createMemoryHistory('/ui'));

        expect(router.resolve({ name: RouteName.RUNS }).href).toBe('/ui/runs');
        expect(router.resolve({ name: RouteName.RUN, params: { id: 'abc' } }).href).toBe('/ui/runs/abc');
        expect(router.resolve({ name: RouteName.APPROVALS }).href).toBe('/ui/approvals');
        expect(router.resolve({ name: RouteName.AGENTS }).href).toBe('/ui/agents');
        expect(router.resolve({ name: RouteName.AGENT, params: { name: 'release-notes' } }).href).toBe('/ui/agents/release-notes');
        expect(router.resolve({
            name: RouteName.AGENT,
            params: { name: 'triage' },
            query: { tab: 'state' },
        }).href).toBe('/ui/agents/triage?tab=state');
        expect(router.resolve({ name: RouteName.SCHEDULES }).href).toBe('/ui/schedules');
        expect(router.resolve({ name: RouteName.LOGIN }).href).toBe('/ui/login');
        expect(router.resolve({ name: RouteName.LOGIN_CALLBACK }).href).toBe('/ui/login/callback');
        expect(router.resolve('/runs/x').name).toBe(RouteName.RUN);
    });

    it('runs the guards in order', async () => {
        const seen: string[] = [];
        const first: NavigationGuard = () => {
            seen.push('first');
        };
        const second: NavigationGuard = () => {
            seen.push('second');
        };
        const router = createUiRouter(DEV_CONFIG, [first, second], createMemoryHistory('/ui'));

        await router.push('/schedules');
        expect(seen).toEqual(['first', 'second']);
        expect(router.currentRoute.value.name).toBe(RouteName.SCHEDULES);
    });

    it('opens on the agents overview and sends an unknown path there', async () => {
        const router = createUiRouter(DEV_CONFIG, [], createMemoryHistory('/ui'));

        await router.push('/');
        expect(router.currentRoute.value.name).toBe(RouteName.AGENTS);
        await router.push('/nope/x');
        expect(router.currentRoute.value.name).toBe(RouteName.AGENTS);
        // the state page moved into the agent page
        await router.push('/state/triage');
        expect(router.currentRoute.value.name).toBe(RouteName.AGENTS);
        expect(Object.values(RouteName)).not.toContain('state');
    });
});
