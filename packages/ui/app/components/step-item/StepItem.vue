<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { computed } from 'vue';
import type { StepWire } from '../../api/types.ts';
import JsonBlock from '../json-block/JsonBlock.vue';
import {
    approverName,
    errorText,
    llmOutput,
    selectedLabels,
    stepMeta,
    stepTitle,
    waitOutput,
} from './helpers.ts';

const props = defineProps<{ step: StepWire }>();

const llm = computed(() => llmOutput(props.step));
const wait = computed(() => waitOutput(props.step));
const selected = computed(() => (props.step.kind === 'wait' ? selectedLabels(props.step) : []));
const classes = computed(() => ['step', `step-${props.step.kind}`, { 'step-err': props.step.error !== undefined }]);
</script>

<template>
    <li
        :class="classes"
        :data-kind="step.kind"
        data-testid="step"
    >
        <span class="step-mark" />
        <VCCollapse class="card step-card">
            <VCCollapseTrigger class="step-sum">
                <span class="step-idx">#{{ step.index }}</span>
                <span :class="['kind', `kind-${step.kind}`]">{{ step.kind }}</span>
                <span :class="['title', { mono: step.kind !== 'llm' }]">{{ stepTitle(step) }}</span>
                <span
                    v-if="step.error !== undefined"
                    class="tag tag-error"
                >tool error</span>
                <span
                    v-if="step.kind === 'wait'"
                    :class="['tag', wait.approved ? 'tag-effect' : 'tag-error']"
                    data-testid="decision"
                >{{ wait.approved ? 'approved' : 'denied' }}<template v-if="approverName(wait)"> by {{ approverName(wait) }}</template></span>
                <span class="meta">{{ stepMeta(step) }}</span>
            </VCCollapseTrigger>
            <VCCollapseContent class="step-body">
                <template v-if="step.kind === 'llm'">
                    <span class="field-label">Finish reason</span>
                    <div class="step-text mono">
                        {{ llm.finishReason ?? '—' }}
                    </div>
                    <template v-if="llm.text">
                        <span class="field-label">Text</span>
                        <div class="step-text">
                            {{ llm.text }}
                        </div>
                    </template>
                    <template v-if="llm.toolCalls?.length">
                        <span class="field-label">Tool calls</span>
                        <JsonBlock :value="llm.toolCalls" />
                    </template>
                </template>
                <template v-else>
                    <span class="field-label">Input</span>
                    <JsonBlock :value="step.input" />
                    <template v-if="step.kind === 'wait'">
                        <span class="field-label">Decision</span>
                        <div class="step-text">
                            {{ wait.approved ? 'Approved' : 'Denied' }}<template v-if="approverName(wait)">
                                by <b>{{ approverName(wait) }}</b> ({{ wait.approver?.kind }})
                            </template><template v-if="wait.reason">
                                : “{{ wait.reason }}”
                            </template>
                        </div>
                        <div
                            v-if="selected.length > 0"
                            class="step-text"
                            data-testid="selected"
                        >
                            Selected: {{ selected.join(', ') }}
                        </div>
                    </template>
                    <template v-else-if="step.error === undefined">
                        <span class="field-label">Output</span>
                        <JsonBlock :value="step.output" />
                    </template>
                </template>
                <div
                    v-if="step.error !== undefined"
                    class="err-line"
                >
                    {{ errorText(step.error) }}
                </div>
            </VCCollapseContent>
        </VCCollapse>
    </li>
</template>
