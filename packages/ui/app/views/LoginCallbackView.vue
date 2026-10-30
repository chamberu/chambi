<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import BrandLogo from '../components/brand-logo/BrandLogo.vue';
import { useAppContext } from '../context/module.ts';
import { RouteName } from '../router/constants.ts';

const { session } = useAppContext();
const route = useRoute();
const router = useRouter();
const error = ref<string>();

onMounted(async () => {
    const pick = (value: unknown) => (typeof value === 'string' ? value : undefined);

    try {
        if (route.query.error) {
            throw new Error(pick(route.query.error_description) ?? pick(route.query.error));
        }

        const returnTo = await session.completeAuthup({ code: pick(route.query.code), state: pick(route.query.state) });

        await router.replace(returnTo);
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    }
});
</script>

<template>
    <div class="login">
        <div class="login-wrap">
            <div class="card login-card">
                <BrandLogo />
                <div>
                    <p class="eyebrow">
                        Dashboard
                    </p>
                    <h1 class="display">
                        {{ error ? 'Sign-in failed' : 'Signing in' }}
                    </h1>
                </div>
                <template v-if="error">
                    <p
                        class="form-err"
                        role="alert"
                    >
                        {{ error }}
                    </p>
                    <RouterLink :to="{ name: RouteName.LOGIN }">
                        Back to sign-in
                    </RouterLink>
                </template>
                <p
                    v-else
                    class="hint"
                >
                    Completing the authup sign-in.
                </p>
            </div>
        </div>
    </div>
</template>
