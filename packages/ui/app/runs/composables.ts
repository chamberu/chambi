/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    onScopeDispose,
    ref,
    shallowRef,
    watch,
} from 'vue';
import type { Ref } from 'vue';
import type { RunStatusLiteral } from '@chamvi/core';
import type { ApiError } from '../api/error.ts';
import { asApiError, retryDelayOf } from '../api/helpers.ts';
import type {
    IApiClient,
    RunListFilter,
    RunPage,
} from '../api/types.ts';
import { ACTIVITY_LIMIT } from '../agents/constants.ts';
import { summarizeActivity } from '../agents/helpers.ts';
import type { Activity } from '../agents/types.ts';
import { createPoller } from '../polling/module.ts';
import { openRunStream } from '../sse/module.ts';
import type { IRunStream, RunStreamOptions } from '../sse/types.ts';
import { RUN_COUNTS_POLL_MS, RUN_LIST_POLL_MS } from './constants.ts';
import { isSettled, lastStepIndex, mergeRunEvent } from './helpers.ts';
import type { RunDetailState } from './helpers.ts';

/** One page of runs, newest first, polled every `RUN_LIST_POLL_MS` while the scope lives. */
export function useRunList(client: IApiClient, filter: Ref<RunListFilter>) {
    const page = shallowRef<RunPage>();
    const error = shallowRef<ApiError>();
    const loading = ref(false);

    const poller = createPoller(async () => {
        loading.value = true;

        try {
            page.value = await client.listRuns(filter.value);
            error.value = undefined;

            return undefined;
        } catch (e) {
            error.value = asApiError(e);

            return retryDelayOf(error.value);
        } finally {
            loading.value = false;
        }
    }, RUN_LIST_POLL_MS);

    watch(filter, () => {
        void poller.refresh();
    }, { deep: true });
    poller.start();
    onScopeDispose(() => poller.stop());

    return {
        page,
        error,
        loading,
        refresh: () => poller.refresh(),
    };
}

/**
 * Every agent's run totals for `statuses` (one `limit: 1` query each, the
 * page's `total`), refreshed together every `RUN_COUNTS_POLL_MS`: one
 * poller instead of one per counter, so the runs page stays far below the
 * app's per-IP rate limit. A failed pass keeps the last totals.
 */
export function useRunCounts(client: IApiClient, statuses: readonly RunStatusLiteral[]) {
    const counts = shallowRef<Partial<Record<RunStatusLiteral, number>>>({});
    const error = shallowRef<ApiError>();
    const poller = createPoller(async () => {
        try {
            const pages = await Promise.all(statuses.map((status) => client.listRuns({ status: [status], limit: 1 })));

            counts.value = Object.fromEntries(statuses.map((status, i) => [status, pages[i]!.meta.total]));
            error.value = undefined;

            return undefined;
        } catch (e) {
            error.value = asApiError(e);

            return retryDelayOf(error.value);
        }
    }, RUN_COUNTS_POLL_MS);

    poller.start();
    onScopeDispose(() => poller.stop());

    return { counts, error };
}

/** The last 24 h over every agent, from the newest `ACTIVITY_LIMIT` runs (the API has no time filter). */
export function useRunActivity(client: IApiClient) {
    const activity = shallowRef<Activity>(summarizeActivity([], Date.now(), ACTIVITY_LIMIT));
    const error = shallowRef<ApiError>();
    const poller = createPoller(async () => {
        try {
            const page = await client.listRuns({ limit: ACTIVITY_LIMIT, offset: 0 });

            activity.value = summarizeActivity(page.data, Date.now(), ACTIVITY_LIMIT);
            error.value = undefined;

            return undefined;
        } catch (e) {
            error.value = asApiError(e);

            return retryDelayOf(error.value);
        }
    }, RUN_COUNTS_POLL_MS);

    poller.start();
    onScopeDispose(() => poller.stop());

    return { activity, error };
}

export type RunDetailDeps = {
    openStream?: (options: RunStreamOptions) => IRunStream;
};

/**
 * A run with its steps, then live over SSE after the last step loaded (a
 * settled run is not streamed); the stream closes on another id and on
 * scope dispose.
 */
export function useRunDetail(client: IApiClient, runId: Ref<string>, deps: RunDetailDeps = {}) {
    const open = deps.openStream ?? openRunStream;
    const state = shallowRef<RunDetailState>();
    const error = shallowRef<ApiError>();
    const live = ref(false);
    let stream: IRunStream | undefined;
    let generation = 0;

    const close = () => {
        stream?.close();
        stream = undefined;
        live.value = false;
    };

    const load = async (id: string) => {
        const current = ++generation;

        close();
        error.value = undefined;

        try {
            const { steps, ...run } = await client.getRun(id);

            if (current !== generation) {
                return;
            }

            state.value = {
                run,
                steps: [...steps].sort((a, b) => a.index - b.index),
                live: {},
            };
        } catch (e) {
            if (current === generation) {
                error.value = asApiError(e);
            }

            return;
        }

        if (isSettled(state.value.run)) {
            return;
        }

        live.value = true;
        stream = open({
            client,
            runId: id,
            after: lastStepIndex(state.value.steps),
            onEvent: (event) => {
                if (current !== generation || !state.value) {
                    return;
                }

                state.value = mergeRunEvent(state.value, event);
            },
            onSettled: () => {
                if (current === generation) {
                    live.value = false;
                }
            },
            onError: (e) => {
                if (current !== generation) {
                    return;
                }

                live.value = false;
                error.value = e;
            },
        });
    };

    watch(runId, (id) => {
        void load(id);
    }, { immediate: true });
    onScopeDispose(() => {
        generation++;
        close();
    });

    return {
        state,
        error,
        live,
        async cancel() {
            await client.cancelRun(runId.value);
        },
    };
}
