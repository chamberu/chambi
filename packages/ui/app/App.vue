<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { useColorMode } from '@vuecs/design';
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import AppShell from './components/app-shell/AppShell.vue';
import { useAppContext } from './context/module.ts';
import { RouteName } from './router/constants.ts';

const route = useRoute();
const router = useRouter();
const { session } = useAppContext();

// the colour mode (system by default) applies to every page, the login included
useColorMode();

const bare = computed(() => route.meta.public === true);
// nothing renders before the first navigation resolved (the start route is no real page),
// and the shell, which polls the API, only for a signed-in principal
const ready = computed(() => route.matched.length > 0);
const shell = computed(() => ready.value && !bare.value && !!session.principal.value);

async function signOut(): Promise<void> {
    await session.signOut();
    await router.replace({ name: RouteName.LOGIN });
}
</script>

<template>
    <VCToastProvider>
        <RouterView v-if="ready && bare" />
        <AppShell
            v-else-if="shell"
            :principal="session.principal.value"
            @sign-out="signOut"
        >
            <RouterView />
        </AppShell>
        <VCToaster position="bottom-right" />
    </VCToastProvider>
    <VCAlertDialogProvider />
</template>
