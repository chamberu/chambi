<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import type { AgentWire, RunPage, RunWire } from '../../api/types.ts';
import { RouteName } from '../../router/constants.ts';
import { RUN_LIST_PAGE_SIZE } from '../../runs/constants.ts';
import { formatTokens, shortId } from '../../runs/helpers.ts';
import NavIcon from '../nav-icon/NavIcon.vue';
import StatusChip from '../status-chip/StatusChip.vue';

const props = defineProps<{
    page?: RunPage;
    agents: readonly AgentWire[];
    loading?: boolean;
    /** The agent the table is scoped to: the trigger column replaces the agent column. */
    scoped?: string;
}>();

const emit = defineEmits<{ page: [offset: number] }>();

defineSlots<{ empty?: () => unknown }>();

const router = useRouter();

const columns = computed(() => [
    { key: 'id', label: 'Run' },
    props.scoped ? { key: 'trigger', label: 'Trigger' } : { key: 'agent', label: 'Agent · trigger' },
    { key: 'status', label: 'Status' },
    { key: 'usage', label: 'Usage' },
    { key: 'createdAt', label: 'Started' },
    { key: 'go', label: '' },
]);

function maxTokensOf(run: RunWire): number | undefined {
    return props.agents.find((a) => a.name === run.agent)?.budget.maxTokens;
}

function tokens(run: RunWire): number {
    return run.usage.inputTokens + run.usage.outputTokens;
}

function inOut(run: RunWire): string {
    return `${formatTokens(run.usage.inputTokens)} in · ${formatTokens(run.usage.outputTokens)} out`;
}

function ratio(run: RunWire): number {
    const max = maxTokensOf(run);

    return max ? Math.min(100, Math.round(tokens(run) / max * 100)) : 0;
}

function by(run: RunWire): string {
    const invoker = run.trigger.invoker ? `by ${run.trigger.invoker.name ?? run.trigger.invoker.id} · ` : '';

    return `${invoker}via ${run.trigger.channel}`;
}

function open(run: RunWire): void {
    void router.push({ name: RouteName.RUN, params: { id: run.id } });
}

const range = computed(() => {
    const meta = props.page?.meta;

    if (!meta || meta.total === 0) {
        return '0 runs';
    }

    return `${meta.offset + 1}–${Math.min(meta.offset + meta.limit, meta.total)} of ${meta.total}`;
});

const row = (value: unknown) => value as RunWire;

/* the mockup's quiet mono pager (style.css `.pager .vc-pagination`), not the theme's filled buttons */
const PAGER_CLASSES = {
    root: 'vc-pagination',
    item: 'vc-pagination-item',
    link: 'vc-pagination-link',
    linkActive: '',
    ellipsis: 'vc-pagination-ellipsis',
};
const PAGER_VARIANT = { variant: 'plain', size: 'plain' };
</script>

<template>
    <div class="card table-card">
        <div
            v-if="page && page.data.length === 0"
            data-testid="runs-empty"
        >
            <slot name="empty" />
        </div>
        <div
            v-else
            class="table-wrap"
        >
            <VCTable
                class="t stack"
                :columns="columns"
                :data="page?.data ?? []"
                :busy="loading && !page"
                row-clickable
                data-testid="runs"
                @row-click="(value: RunWire) => open(value)"
            >
                <template #cell-id="{ row: value }">
                    <span class="id">{{ shortId(row(value).id) }}</span>
                    <div class="sub mono">
                        {{ row(value).concurrencyKey ?? '—' }}
                    </div>
                </template>
                <template #cell-agent="{ row: value }">
                    <RouterLink
                        :to="{ name: RouteName.AGENT, params: { name: row(value).agent } }"
                        data-testid="agent-link"
                        @click.stop
                    >
                        {{ row(value).agent }}
                    </RouterLink>
                    <div class="sub">
                        {{ row(value).trigger.trigger }}
                    </div>
                </template>
                <template #cell-trigger="{ row: value }">
                    <span
                        class="mono"
                        style="font-size: 12.5px"
                    >{{ row(value).trigger.trigger }}</span>
                    <div class="sub">
                        {{ by(row(value)) }}
                    </div>
                </template>
                <template #cell-status="{ row: value }">
                    <StatusChip :status="row(value).status" />
                </template>
                <template #cell-usage="{ row: value }">
                    <div class="usage">
                        <div class="usage-top">
                            <span class="muted">{{ inOut(row(value)) }}</span>
                            <span>{{ formatTokens(tokens(row(value))) }} tok</span>
                        </div>
                        <div :class="['bar', `u-${row(value).status}`]">
                            <i :style="{ width: `${ratio(row(value))}%` }" />
                        </div>
                    </div>
                </template>
                <template #cell-createdAt="{ row: value }">
                    <span class="when"><VCTimeago :datetime="row(value).createdAt" /></span>
                </template>
                <template #cell-go>
                    <span
                        class="go"
                        aria-hidden="true"
                    ><NavIcon name="go" /></span>
                </template>
            </VCTable>
        </div>
        <div
            v-if="page && page.data.length > 0"
            class="pager"
        >
            <span class="tnum">{{ range }}</span>
            <VCPagination
                v-if="page.meta.total > RUN_LIST_PAGE_SIZE"
                :total="page.meta.total"
                :limit="page.meta.limit"
                :offset="page.meta.offset"
                :theme-class="PAGER_CLASSES"
                :theme-variant="PAGER_VARIANT"
                @load="(meta: { offset: number }) => emit('page', meta.offset)"
            />
        </div>
    </div>
</template>
