<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { useColorMode } from '@vuecs/design';
import { computed, provide } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { MeWire } from '../../api/types.ts';
import { useApprovals } from '../../approvals/composables.ts';
import { INBOX } from '../../approvals/constants.ts';
import { useAppContext } from '../../context/module.ts';
import { RouteName } from '../../router/constants.ts';
import BrandLogo from '../brand-logo/BrandLogo.vue';
import NavIcon from '../nav-icon/NavIcon.vue';

const props = defineProps<{ principal?: MeWire }>();

// one inbox for the badge and the approvals view
const { client } = useAppContext();
const inbox = useApprovals(client);

provide(INBOX, inbox);

const waiting = computed(() => inbox.runs.value.length);

const emit = defineEmits<{ signOut: [] }>();

const route = useRoute();
const { host } = globalThis.location;
const colorMode = useColorMode();

const items = [
    {
        name: RouteName.AGENTS,
        label: 'Agents',
        icon: 'agents',
        also: [RouteName.AGENT],
    },
    {
        name: RouteName.RUNS,
        label: 'Runs',
        icon: 'runs',
        also: [RouteName.RUN],
    },
    {
        name: RouteName.APPROVALS,
        label: 'Approvals',
        icon: 'approvals',
        also: [],
    },
    {
        name: RouteName.SCHEDULES,
        label: 'Schedules',
        icon: 'schedules',
        also: [],
    },
] as const;

function isCurrent(item: typeof items[number]): boolean {
    return route.name === item.name || (item.also as readonly string[]).includes(String(route.name));
}

const displayName = computed(() => props.principal?.name ?? props.principal?.id ?? '');
const initials = computed(() => displayName.value.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?');
const grants = computed(() => {
    const count = props.principal?.permissions.length ?? 0;

    return `${props.principal?.kind ?? ''} · ${count} ${count === 1 ? 'grant' : 'grants'}`;
});
</script>

<template>
    <div class="app shell">
        <aside class="side">
            <BrandLogo />
            <nav aria-label="Main">
                <div class="nav-group">
                    Operate
                </div>
                <RouterLink
                    v-for="item in items"
                    :key="item.name"
                    :to="{ name: item.name }"
                    class="nav-item"
                    :aria-current="isCurrent(item) ? 'page' : undefined"
                >
                    <NavIcon :name="item.icon" />
                    {{ item.label }}
                    <span
                        v-if="item.name === RouteName.APPROVALS && waiting"
                        class="badge"
                        :aria-label="`${waiting} waiting`"
                    >{{ waiting }}</span>
                </RouterLink>
            </nav>
            <div class="side-foot">
                <div
                    class="env"
                    :title="host"
                >
                    <span>{{ host }}</span>
                </div>
                <div class="who">
                    <span
                        class="avatar"
                        aria-hidden="true"
                    >{{ initials }}</span>
                    <div class="who-text">
                        <div
                            class="who-name"
                            data-testid="principal"
                        >
                            {{ displayName }}
                        </div>
                        <div class="who-sub">
                            {{ grants }}
                        </div>
                    </div>
                    <div class="who-actions">
                        <button
                            type="button"
                            class="icon-btn"
                            :title="colorMode.isDark.value ? 'Light mode' : 'Dark mode'"
                            :aria-label="colorMode.isDark.value ? 'Light mode' : 'Dark mode'"
                            @click="colorMode.toggle()"
                        >
                            <NavIcon :name="colorMode.isDark.value ? 'sun' : 'moon'" />
                        </button>
                        <button
                            type="button"
                            class="icon-btn"
                            title="Sign out"
                            aria-label="Sign out"
                            @click="emit('signOut')"
                        >
                            <NavIcon name="logout" />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
        <div class="canvas">
            <main class="main">
                <slot />
            </main>
        </div>
    </div>
</template>
