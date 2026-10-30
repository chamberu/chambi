/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import type { AgentWire, PageQuery } from '../../../../app/api/types.ts';
import { KV_PAGE_SIZE } from '../../../../app/state/constants.ts';
import { useAgentState } from '../../../../app/state/composables.ts';
import { apiError, fakeClient } from '../../../utils/client.ts';
import { flush } from '../../../utils/timers.ts';

const agent = (name: string, state: string[]): AgentWire => ({
    name,
    channels: [],
    budget: { maxSteps: 20 },
    state,
});

function stateClient() {
    const kvCalls: Array<[string, PageQuery | undefined]> = [];
    const docCalls: Array<[string, string]> = [];
    const client = fakeClient({
        listAgents: async () => ({ data: [agent('triage', ['duplicates', 'triaged']), agent('digest', [])], issues: [] }),
        listKv: async (name, page) => {
            kvCalls.push([name, page]);

            return [{ key: `${name}-k`, value: { n: 1 } }];
        },
        listDocs: async (name, collection) => {
            docCalls.push([name, collection]);

            return [{ id: 'd1', issue: 1 }];
        },
    });

    return {
        client,
        kvCalls,
        docCalls,
    };
}

describe('useAgentState', () => {
    it('loads kv and the agent\'s collections', async () => {
        const { client, kvCalls } = stateClient();
        const scope = effectScope();
        const state = scope.run(() => useAgentState(client, ref('triage')))!;

        await flush();
        expect(state.kv.value).toEqual([{ key: 'triage-k', value: { n: 1 } }]);
        expect(state.collections.value).toEqual(['duplicates', 'triaged']);
        expect(kvCalls).toEqual([['triage', { limit: KV_PAGE_SIZE, offset: 0 }]]);
        expect(state.moreKv.value).toBe(false);
        scope.stop();
    });

    it('loads a collection on demand', async () => {
        const { client, docCalls } = stateClient();
        const scope = effectScope();
        const state = scope.run(() => useAgentState(client, ref('triage')))!;

        await flush();
        expect(docCalls).toEqual([]);
        await state.loadCollection('duplicates');
        expect(state.docs.value).toEqual({ duplicates: [{ id: 'd1', issue: 1 }] });
        expect(docCalls).toEqual([['triage', 'duplicates']]);
        scope.stop();
    });

    it('resets when the agent changes', async () => {
        const { client } = stateClient();
        const name = ref<string | undefined>('triage');
        const scope = effectScope();
        const state = scope.run(() => useAgentState(client, name))!;

        await flush();
        await state.loadCollection('duplicates');
        name.value = 'digest';
        await nextTick();
        expect(state.docs.value).toEqual({});
        await flush();
        expect(state.kv.value[0]?.key).toBe('digest-k');
        expect(state.collections.value).toEqual([]);
        name.value = undefined;
        await nextTick();
        await flush();
        expect(state.kv.value).toEqual([]);
        scope.stop();
    });

    it('pages kv with an offset', async () => {
        const pages: PageQuery[] = [];
        const client = fakeClient({
            listAgents: async () => ({ data: [agent('triage', [])], issues: [] }),
            listKv: async (_name, page) => {
                pages.push(page!);

                const count = page!.offset === 0 ? KV_PAGE_SIZE : 1;

                return Array.from({ length: count }, (_, i) => ({ key: `k${page!.offset! + i}`, value: i }));
            },
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentState(client, ref('triage')))!;

        await flush();
        expect(state.moreKv.value).toBe(true);
        await state.loadMoreKv();
        expect(pages[1]).toEqual({ limit: KV_PAGE_SIZE, offset: KV_PAGE_SIZE });
        expect(state.kv.value).toHaveLength(KV_PAGE_SIZE + 1);
        expect(state.moreKv.value).toBe(false);
        scope.stop();
    });

    it('a 403 sets error without throwing', async () => {
        const client = fakeClient({
            listAgents: async () => ({ data: [agent('triage', ['c'])], issues: [] }),
            listKv: async () => {
                throw apiError(403, 'forbidden');
            },
            listDocs: async () => {
                throw apiError(403, 'forbidden');
            },
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentState(client, ref('triage')))!;

        await flush();
        expect(state.error.value?.status).toBe(403);
        await state.loadCollection('c');
        expect(state.error.value?.status).toBe(403);
        scope.stop();
    });
});
