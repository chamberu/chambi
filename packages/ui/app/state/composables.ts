/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type { ApiError } from '../api/error.ts';
import type {
    DocEntry,
    IApiClient,
    KvEntry,
} from '../api/types.ts';
import { asApiError } from '../api/helpers.ts';
import { DOC_PAGE_SIZE, KV_PAGE_SIZE } from './constants.ts';

/**
 * An agent's state, read-only: the KV entries (paged by `KV_PAGE_SIZE`),
 * the declared collections (from the agent summary) and their first
 * documents, loaded when a collection opens. Everything resets on another
 * agent; a 403 (no `state:read`) lands in `error`.
 */
export function useAgentState(client: IApiClient, agent: Ref<string | undefined>) {
    const kv = shallowRef<KvEntry[]>([]);
    const moreKv = shallowRef(false);
    const collections = shallowRef<string[]>([]);
    const docs = shallowRef<Record<string, DocEntry[]>>({});
    const error = shallowRef<ApiError>();
    let generation = 0;

    const loadKv = async (name: string, offset: number, current: number) => {
        const page = await client.listKv(name, { limit: KV_PAGE_SIZE, offset });

        if (current !== generation) {
            return;
        }

        kv.value = offset === 0 ? page : [...kv.value, ...page];
        moreKv.value = page.length === KV_PAGE_SIZE;
    };

    watch(agent, async (name) => {
        const current = ++generation;

        kv.value = [];
        moreKv.value = false;
        collections.value = [];
        docs.value = {};
        error.value = undefined;

        if (!name) {
            return;
        }

        try {
            const { data: agents } = await client.listAgents();

            if (current !== generation) {
                return;
            }

            collections.value = agents.find((a) => a.name === name)?.state ?? [];
            await loadKv(name, 0, current);
        } catch (e) {
            if (current === generation) {
                error.value = asApiError(e);
            }
        }
    }, { immediate: true });

    return {
        kv,
        moreKv,
        collections,
        docs,
        error,
        async loadMoreKv() {
            const name = agent.value;

            if (!name) {
                return;
            }

            try {
                await loadKv(name, kv.value.length, generation);
            } catch (e) {
                error.value = asApiError(e);
            }
        },
        async loadCollection(collection: string) {
            const name = agent.value;

            if (!name) {
                return;
            }

            const current = generation;

            try {
                const list = await client.listDocs(name, collection, { limit: DOC_PAGE_SIZE });

                if (current === generation) {
                    docs.value = { ...docs.value, [collection]: list };
                }
            } catch (e) {
                if (current === generation) {
                    error.value = asApiError(e);
                }
            }
        },
    };
}
