<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api/error.ts';
import { safeReturnPath } from '../auth/helpers.ts';
import BrandLogo from '../components/brand-logo/BrandLogo.vue';
import { UI_VERSION } from '../config/constants.ts';
import { useAppContext } from '../context/module.ts';

const { config, session } = useAppContext();
const route = useRoute();
const router = useRouter();

const token = ref('');
const error = ref<string>();
const busy = ref(false);

const returnTo = computed(() => safeReturnPath(route.query.redirect));
const authupHost = computed(() => (config.auth.authup ? new URL(config.auth.authup.url).host : ''));
const { host } = globalThis.location;

async function useToken(): Promise<void> {
    if (!token.value.trim()) {
        error.value = 'Paste a token first.';

        return;
    }

    busy.value = true;
    error.value = undefined;

    try {
        await session.signInWithToken(token.value.trim());
        token.value = '';
        await router.replace(returnTo.value);
    } catch (e) {
        error.value = e instanceof ApiError && e.status === 401 ?
            'The API refused this token.' :
            `Sign-in failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        busy.value = false;
    }
}

async function useAuthup(): Promise<void> {
    busy.value = true;
    error.value = undefined;

    try {
        await session.startAuthup(returnTo.value);
    } catch (e) {
        error.value = `Sign-in failed: ${e instanceof Error ? e.message : String(e)}`;
        busy.value = false;
    }
}
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
                        Sign in
                    </h1>
                </div>
                <template v-if="config.auth.authup">
                    <VCButton
                        class="btn btn-primary btn-block"
                        :loading="busy"
                        @click="useAuthup"
                    >
                        Continue with authup
                    </VCButton>
                    <p
                        class="hint"
                        style="text-align: center; margin-top: -8px"
                    >
                        Redirects to {{ authupHost }} and back (OIDC code flow).
                    </p>
                </template>
                <div
                    v-if="config.auth.authup && config.auth.tokens"
                    class="or"
                >
                    or paste a token
                </div>
                <form
                    v-if="config.auth.tokens"
                    @submit.prevent="useToken"
                >
                    <label class="field">
                        <span class="field-label">Bearer token</span>
                        <VCFormInput
                            v-model="token"
                            class="mono"
                            type="password"
                            placeholder="paste a static token"
                            autocomplete="off"
                            name="token"
                        />
                    </label>
                    <VCButton
                        type="submit"
                        :class="['btn', 'btn-block', { 'btn-primary': !config.auth.authup }]"
                        :loading="busy"
                    >
                        Use token
                    </VCButton>
                    <p class="hint">
                        A static token from <span class="mono">staticTokens()</span>. Kept in sessionStorage for this tab only.
                    </p>
                </form>
                <p
                    v-if="error"
                    class="form-err"
                    role="alert"
                >
                    {{ error }}
                </p>
            </div>
            <p class="login-foot">
                chamvi {{ UI_VERSION }} · self-hosted at {{ host }}
            </p>
        </div>
    </div>
</template>
