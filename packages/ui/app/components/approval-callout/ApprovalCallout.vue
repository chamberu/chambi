<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    computed,
    nextTick,
    onMounted,
    ref,
    watch,
} from 'vue';
import { RouterLink } from 'vue-router';
import type { RunWire } from '../../api/types.ts';
import { canApprove, detailLines, notifiedLine } from '../../approvals/helpers.ts';
import { RouteName } from '../../router/constants.ts';
import { shortId } from '../../runs/helpers.ts';
import ExpiryCountdown from '../expiry-countdown/ExpiryCountdown.vue';
import NavIcon from '../nav-icon/NavIcon.vue';
import StatusChip from '../status-chip/StatusChip.vue';

const props = defineProps<{
    run: RunWire;
    /** The principal holds `agent:<agent>:approve`. */
    canAnswer: boolean;
    busy?: boolean;
    /** The approval a link opened: highlighted, scrolled into view and focused. */
    highlight?: boolean;
}>();

const emit = defineEmits<{ answer: [approved: boolean, reason: string, selected: string[]] }>();
const reason = ref('');
/** The chosen option ids of a choice approval (one for radios). */
const selected = ref<string[]>([]);
const single = ref<string>();

const options = computed(() => props.run.waiting?.options ?? []);
const multiple = computed(() => props.run.waiting?.multiple === true);
const chosen = computed<string[]>(() => {
    if (multiple.value) {
        return selected.value;
    }

    return single.value !== undefined ? [single.value] : [];
});
const approvable = computed(() => !props.run.waiting || canApprove(props.run.waiting, chosen.value));

// another wait point of the run: its options are others
watch(() => props.run.waiting?.approvalId, () => {
    selected.value = [];
    single.value = undefined;
});

function send(approved: boolean): void {
    // a denial selects nothing
    emit('answer', approved, reason.value, approved ? [...chosen.value] : []);
}

const id = `reason-${props.run.id}`;
const notified = computed(() => notifiedLine(props.run));

const root = ref<globalThis.HTMLElement>();
async function reveal(): Promise<void> {
    if (!props.highlight) {
        return;
    }

    await nextTick();
    root.value?.scrollIntoView({ block: 'center' });
    root.value?.focus({ preventScroll: true });
}
onMounted(reveal);
watch(() => props.highlight, reveal);
</script>

<template>
    <article
        v-if="run.waiting"
        ref="root"
        :class="['callout', { linked: highlight }]"
        data-testid="approval"
        :data-run="run.id"
        :data-linked="highlight ? 'true' : undefined"
        :tabindex="highlight ? -1 : undefined"
        :aria-label="highlight ? `Linked approval: ${run.waiting.title}, run ${shortId(run.id)}` : undefined"
    >
        <div class="callout-head">
            <span class="callout-icon"><NavIcon name="hand" /></span>
            <div class="callout-title">
                <h2><span data-testid="approval-title">{{ run.waiting.title }}</span><StatusChip status="waiting" /></h2>
                <p>
                    <RouterLink
                        :to="{ name: RouteName.AGENT, params: { name: run.agent } }"
                        data-testid="agent-link"
                    >
                        {{ run.agent }}
                    </RouterLink>
                    · run
                    <RouterLink
                        class="mono"
                        :to="{ name: RouteName.RUN, params: { id: run.id } }"
                    >
                        {{ shortId(run.id) }}
                    </RouterLink>
                    <template v-if="run.concurrencyKey">
                        · {{ run.concurrencyKey }}
                    </template>
                </p>
            </div>
            <div class="timer">
                <small>Expires in</small>
                <ExpiryCountdown :until="run.waiting.expiresAt" />
                <span>then denied</span>
            </div>
        </div>
        <div class="callout-body">
            <div>
                <p
                    v-if="run.waiting.body"
                    class="callout-text"
                    data-testid="approval-body"
                    v-text="run.waiting.body"
                />
                <p
                    v-else
                    class="callout-text muted"
                >
                    No details given.
                </p>
                <fieldset
                    v-if="options.length > 0"
                    class="callout-options"
                    data-testid="approval-options"
                >
                    <legend class="field-label">
                        {{ multiple ? 'Choose one or more' : 'Choose one' }}
                    </legend>
                    <div
                        v-for="option in options"
                        :key="option.id"
                        class="callout-option"
                    >
                        <label
                            data-testid="approval-option"
                            :data-option="option.id"
                        >
                            <input
                                v-if="multiple"
                                v-model="selected"
                                type="checkbox"
                                :value="option.id"
                                :disabled="!canAnswer"
                            >
                            <input
                                v-else
                                v-model="single"
                                type="radio"
                                :name="`option-${run.id}`"
                                :value="option.id"
                                :disabled="!canAnswer"
                            >
                            <span>{{ option.label }}</span>
                            <span class="mono muted">{{ option.id }}</span>
                        </label>
                        <details v-if="option.detail">
                            <summary>Details</summary>
                            <pre class="option-detail"><template
                                v-for="(line, index) in detailLines(option.detail)"
                                :key="index"
                            ><span :class="line.kind ? `diff-${line.kind}` : undefined">{{ line.text }}</span>{{ '\n' }}</template></pre>
                        </details>
                    </div>
                </fieldset>
            </div>
            <div>
                <dl class="callout-meta">
                    <dt>tool</dt>
                    <dd
                        class="mono"
                        data-testid="approval-tool"
                    >
                        {{ run.waiting.toolName }}
                    </dd>
                    <dt>requested</dt>
                    <dd><VCTimeago :datetime="run.updatedAt" /></dd>
                    <dt>notified</dt>
                    <dd
                        :class="{ warn: notified.warn }"
                        data-testid="notified"
                    >
                        {{ notified.text }}
                    </dd>
                </dl>
                <label
                    v-if="canAnswer"
                    class="field"
                    :for="id"
                >
                    <span class="field-label">Reason (optional, sent to the model)</span>
                    <VCFormTextarea
                        :id="id"
                        v-model="reason"
                        class="textarea"
                        rows="3"
                        placeholder="Why, in one line"
                    />
                </label>
            </div>
        </div>
        <div class="callout-foot">
            <p v-if="canAnswer">
                Approving or denying queues the run again.
            </p>
            <p v-else>
                Answering needs <span class="mono">agent:{{ run.agent }}:approve</span>.
            </p>
            <div
                v-if="canAnswer"
                class="callout-actions"
            >
                <VCButton
                    class="btn"
                    :disabled="busy"
                    @click="send(false)"
                >
                    Deny
                </VCButton>
                <VCButton
                    class="btn btn-primary"
                    :loading="busy"
                    :disabled="busy || !approvable"
                    data-testid="approve"
                    @click="send(true)"
                >
                    <NavIcon name="check" />Approve
                </VCButton>
            </div>
        </div>
    </article>
</template>
