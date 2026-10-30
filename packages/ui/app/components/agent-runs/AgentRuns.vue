<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunStatusLiteral } from '@chamvi/core';
import { computed, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AgentWire, RunListFilter } from '../../api/types.ts';
import { useAppContext } from '../../context/module.ts';
import { useRunList } from '../../runs/composables.ts';
import { RUN_STATUSES } from '../../runs/constants.ts';
import { filterFromQuery, queryFromFilter } from '../../runs/query.ts';
import EmptyState from '../empty-state/EmptyState.vue';
import RunsTable from '../runs-table/RunsTable.vue';

const props = defineProps<{ agent: AgentWire }>();

const { client } = useAppContext();
const route = useRoute();
const router = useRouter();

// the status filter and page live in the query, next to ?tab=runs
const read = (): RunListFilter => ({ ...filterFromQuery(route.query), agent: props.agent.name });
const filter = shallowRef<RunListFilter>(read());

watch(() => [route.query, props.agent.name], () => {
    filter.value = read();
});

const { page, loading } = useRunList(client, filter);

function update(next: Partial<RunListFilter>): void {
    const query = queryFromFilter({
        ...filter.value,
        agent: undefined,
        offset: 0,
        ...next,
    });

    void router.replace({ query: { ...query, tab: 'runs' } });
}

function toggleStatus(status: RunStatusLiteral): void {
    const current = filter.value.status ?? [];

    update({ status: current.includes(status) ? current.filter((s) => s !== status) : [...current, status] });
}

const filtered = computed(() => !!filter.value.status?.length);
</script>

<template>
    <div class="toolbar">
        <div
            class="field"
            style="min-width: 0; flex: 1"
        >
            <span class="field-label">Status</span>
            <div>
                <div
                    class="seg"
                    role="group"
                    aria-label="Status filter"
                >
                    <button
                        v-for="status in RUN_STATUSES"
                        :key="status"
                        type="button"
                        :data-status="status"
                        :aria-pressed="(filter.status ?? []).includes(status)"
                        @click="toggleStatus(status)"
                    >
                        {{ status }}
                    </button>
                </div>
            </div>
        </div>
    </div>
    <RunsTable
        :page="page"
        :agents="[agent]"
        :loading="loading"
        :scoped="agent.name"
        @page="(offset) => update({ offset, status: filter.status })"
    >
        <template #empty>
            <EmptyState
                v-if="filtered"
                icon="search"
                title="No runs match these filters"
                :text="`Nothing of ${agent.name} with this status. Widen the status filter.`"
            >
                <button
                    type="button"
                    class="btn btn-sm"
                    @click="update({ status: undefined })"
                >
                    Clear filters
                </button>
            </EmptyState>
            <EmptyState
                v-else
                icon="play"
                title="No runs yet"
                :text="`${agent.name} has not run. Start a run from the header, or wait for one of its triggers.`"
            />
        </template>
    </RunsTable>
</template>
