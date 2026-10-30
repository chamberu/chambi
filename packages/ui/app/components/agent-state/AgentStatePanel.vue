<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { computed, ref, watch } from 'vue';
import type { DocEntry, KvEntry } from '../../api/types.ts';
import type { useAgentState } from '../../state/composables.ts';
import { DOC_PAGE_SIZE } from '../../state/constants.ts';
import { docColumns, inlineJson } from '../../state/helpers.ts';
import EmptyState from '../empty-state/EmptyState.vue';
import JsonBlock from '../json-block/JsonBlock.vue';
import NavIcon from '../nav-icon/NavIcon.vue';
import { panelId, tabId } from '../tab-list/helpers.ts';
import TabList from '../tab-list/TabList.vue';

const props = defineProps<{
    agent: string;
    state: ReturnType<typeof useAgentState>;
}>();

const STATE_TABS = ['kv', 'collections'] as const;
const tab = ref<typeof STATE_TABS[number]>('kv');
const collection = ref<string>();
const kvOpen = ref<string[]>([]);
const docOpen = ref<string[]>([]);

watch(() => props.state.collections.value, (list) => {
    collection.value = list[0];
}, { immediate: true });
watch(collection, (name) => {
    docOpen.value = [];

    if (name && !props.state.docs.value[name]) {
        void props.state.loadCollection(name);
    }
}, { immediate: true });

const docs = computed<DocEntry[]>(() => (collection.value ? props.state.docs.value[collection.value] ?? [] : []));
const docKeys = computed(() => docColumns(docs.value));

function cell(doc: DocEntry, key: string): string {
    if (key === 'id') {
        return doc.id;
    }

    return doc[key] === undefined ? '' : inlineJson(doc[key]);
}

function toggle(which: 'kv' | 'doc', key: string): void {
    const list = which === 'kv' ? kvOpen : docOpen;

    list.value = list.value.includes(key) ? list.value.filter((k) => k !== key) : [...list.value, key];
}
</script>

<template>
    <div class="tab-lede">
        <p>What {{ agent }} remembers between runs. Read-only for now.</p>
        <span class="ro"><NavIcon name="lock" />read-only</span>
    </div>

    <div
        v-if="state.error.value?.status === 403"
        class="card notice"
    >
        Reading agent state needs <b class="mono">state:read</b>.
    </div>
    <template v-else>
        <TabList
            v-model="tab"
            :tabs="STATE_TABS"
            prefix="state"
            label="State kinds"
        >
            <template #tab="{ tab: id }">
                <template v-if="id === 'kv'">
                    Key-value <span class="count">{{ state.kv.value.length }}{{ state.moreKv.value ? '+' : '' }}</span>
                </template>
                <template v-else>
                    Collections <span class="count">{{ state.collections.value.length }}</span>
                </template>
            </template>
        </TabList>

        <div
            :id="panelId('state')"
            role="tabpanel"
            :aria-labelledby="tabId('state', tab)"
        >
            <template v-if="tab === 'kv'">
                <div
                    v-if="state.kv.value.length === 0"
                    class="card"
                >
                    <EmptyState
                        icon="lock"
                        title="No keys yet"
                        :text="`${agent} has not written anything with state.set(). Keys appear here after its first run that does.`"
                    />
                </div>
                <div
                    v-else
                    class="card table-card"
                >
                    <div class="table-wrap">
                        <table
                            class="t stack"
                            data-testid="kv"
                        >
                            <thead>
                                <tr>
                                    <th style="width: 220px">
                                        Key
                                    </th>
                                    <th>Value (JSON)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <template
                                    v-for="entry in (state.kv.value as KvEntry[])"
                                    :key="entry.key"
                                >
                                    <tr
                                        class="clickable"
                                        tabindex="0"
                                        :aria-expanded="kvOpen.includes(entry.key)"
                                        @click="toggle('kv', entry.key)"
                                        @keydown.enter.prevent="toggle('kv', entry.key)"
                                    >
                                        <td
                                            data-label="Key"
                                            class="mono"
                                            style="font-size: 13px; white-space: nowrap"
                                        >
                                            <span class="caret-x" />{{ entry.key }}
                                        </td>
                                        <td
                                            data-label="Value"
                                            class="full"
                                        >
                                            <span class="json-inline">{{ inlineJson(entry.value) }}</span>
                                        </td>
                                    </tr>
                                    <tr
                                        v-if="kvOpen.includes(entry.key)"
                                        class="expansion"
                                    >
                                        <td colspan="2">
                                            <JsonBlock :value="entry.value" />
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                    <div
                        v-if="state.moreKv.value"
                        class="pager"
                    >
                        <span>{{ state.kv.value.length }} shown</span>
                        <VCButton
                            class="btn btn-sm"
                            @click="state.loadMoreKv()"
                        >
                            Load more
                        </VCButton>
                    </div>
                </div>
            </template>

            <div
                v-else-if="state.collections.value.length === 0"
                class="card"
            >
                <EmptyState
                    icon="lock"
                    title="No collections"
                    :text="`${agent} declares no state collections in defineAgent({ state }).`"
                />
            </div>
            <div
                v-else
                class="split"
            >
                <div class="card">
                    <div class="list-head field-label">
                        Collections
                    </div>
                    <ul class="list">
                        <li
                            v-for="name in state.collections.value"
                            :key="name"
                        >
                            <button
                                type="button"
                                :aria-current="name === collection"
                                @click="collection = name"
                            >
                                <span>{{ name }}</span><span v-if="state.docs.value[name]">{{ state.docs.value[name]!.length }}</span>
                            </button>
                        </li>
                    </ul>
                </div>
                <div
                    v-if="collection"
                    style="min-width: 0"
                >
                    <p
                        v-if="docs.length === DOC_PAGE_SIZE"
                        class="hint"
                        style="margin-bottom: 10px"
                    >
                        Showing the first {{ DOC_PAGE_SIZE }} documents.
                    </p>
                    <div class="card table-card">
                        <div class="table-wrap">
                            <table class="t stack">
                                <thead>
                                    <tr>
                                        <th
                                            v-for="key in docKeys"
                                            :key="key"
                                        >
                                            {{ key }}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <template
                                        v-for="doc in docs"
                                        :key="doc.id"
                                    >
                                        <tr
                                            class="clickable"
                                            tabindex="0"
                                            :aria-expanded="docOpen.includes(doc.id)"
                                            @click="toggle('doc', doc.id)"
                                            @keydown.enter.prevent="toggle('doc', doc.id)"
                                        >
                                            <td
                                                v-for="key in docKeys"
                                                :key="key"
                                                :data-label="key"
                                                :class="['mono', { full: key === 'id' }]"
                                                style="font-size: 12.5px"
                                            >
                                                <span
                                                    v-if="key === 'id'"
                                                    class="caret-x"
                                                /><span :class="{ 'json-inline': key !== 'id' }">{{ cell(doc, key) }}</span>
                                            </td>
                                        </tr>
                                        <tr
                                            v-if="docOpen.includes(doc.id)"
                                            class="expansion"
                                        >
                                            <td :colspan="docKeys.length">
                                                <JsonBlock :value="doc" />
                                            </td>
                                        </tr>
                                    </template>
                                    <tr v-if="docs.length === 0">
                                        <td
                                            :colspan="docKeys.length"
                                            class="full"
                                        >
                                            <EmptyState
                                                icon="search"
                                                title="No documents"
                                                :text="`${collection} holds no documents yet.`"
                                            />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </template>
</template>
