<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ref, watch } from 'vue';
import { createStartKeys, parsePayload } from '../../agents/helpers.ts';
import { ApiError } from '../../api/error.ts';
import type { StartRunResult } from '../../api/types.ts';

const props = defineProps<{
    agent: string;
    /** Who the run is started as, for the lede. */
    invoker?: string;
    start: (payload: unknown, idempotencyKey: string) => Promise<StartRunResult>;
}>();

const emit = defineEmits<{ started: [result: StartRunResult] }>();
const open = defineModel<boolean>('open', { required: true });

const payload = ref('{}');
const error = ref<string>();
const busy = ref(false);
const keys = createStartKeys();

watch(open, (value) => {
    if (!value) {
        return;
    }

    error.value = undefined;
});

async function submit(): Promise<void> {
    const parsed = parsePayload(payload.value);

    if (!parsed.ok) {
        error.value = parsed.message;

        return;
    }

    busy.value = true;
    error.value = undefined;

    try {
        const result = await props.start(parsed.value, keys.keyFor(payload.value));

        keys.succeeded();
        open.value = false;
        emit('started', result);
    } catch (e) {
        error.value = e instanceof ApiError ? `${e.code} · ${e.message}` : String(e);
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <VCModal v-model:open="open">
        <VCModalContent class="modal card">
            <form
                style="display: grid; gap: 12px"
                novalidate
                data-testid="start-run"
                @submit.prevent="submit"
            >
                <VCModalTitle class="display">
                    Start a run of {{ agent }}
                </VCModalTitle>
                <VCModalDescription>
                    Dispatches through the http trigger<template v-if="invoker">
                        as {{ invoker }}
                    </template>. The payload becomes the run's first message, checked against the trigger's schema if it has one.
                </VCModalDescription>
                <label class="field">
                    <span class="field-label">Payload (JSON)</span>
                    <textarea
                        v-model="payload"
                        class="textarea mono"
                        rows="7"
                        spellcheck="false"
                        name="payload"
                    />
                </label>
                <p
                    v-if="error"
                    class="form-err"
                    role="alert"
                >
                    {{ error }}
                </p>
                <div class="modal-actions">
                    <VCButton
                        type="button"
                        class="btn"
                        @click="open = false"
                    >
                        Cancel
                    </VCButton>
                    <VCButton
                        type="submit"
                        class="btn btn-primary"
                        :loading="busy"
                    >
                        Start run
                    </VCButton>
                </div>
            </form>
        </VCModalContent>
    </VCModal>
</template>
