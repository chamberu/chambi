/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    computed,
    onScopeDispose,
    shallowRef,
    watch,
} from 'vue';
import type { Ref } from 'vue';
import { ApiError } from '../api/error.ts';
import type { IApiClient, RunDetail, RunWire } from '../api/types.ts';
import { createPoller } from '../polling/module.ts';
import { asApiError, retryDelayOf } from '../api/helpers.ts';
import { INBOX_PAGE_SIZE, INBOX_POLL_MS } from './constants.ts';
import type { AnswerResult, ApprovalLink } from './types.ts';

function reasonOf(reason: string | undefined): { reason?: string } {
    const trimmed = reason?.trim();

    return trimmed ? { reason: trimmed } : {};
}

/**
 * The approvals inbox: waiting runs, newest first, polled every
 * `INBOX_POLL_MS`. `answer` approves or denies the run's current wait
 * point by id (`POST /runs/:id/approve`): a 409 (answered meanwhile,
 * expired, or moved on to another approval) is `already-answered`, a 403
 * `forbidden`; the list refreshes either way.
 */
export function useApprovals(client: IApiClient) {
    const runs = shallowRef<RunWire[]>([]);
    const error = shallowRef<ApiError>();
    const poller = createPoller(async () => {
        try {
            const page = await client.listRuns({
                status: ['waiting'],
                limit: INBOX_PAGE_SIZE,
                offset: 0,
            });

            runs.value = page.data.filter((run) => run.waiting);
            error.value = undefined;

            return undefined;
        } catch (e) {
            error.value = asApiError(e);

            return retryDelayOf(error.value);
        }
    }, INBOX_POLL_MS);

    poller.start();
    onScopeDispose(() => poller.stop());

    async function answer(run: RunWire, approved: boolean, reason?: string, selected?: string[]): Promise<AnswerResult> {
        if (!run.waiting) {
            return 'already-answered';
        }

        try {
            await client.approve(run.id, {
                approvalId: run.waiting.approvalId,
                approved,
                ...reasonOf(reason),
                // a denial selects nothing
                ...(approved && selected && selected.length > 0 ? { selected: [...selected] } : {}),
            });

            return 'answered';
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
                return 'already-answered';
            }

            if (e instanceof ApiError && e.status === 403) {
                return 'forbidden';
            }

            throw e;
        } finally {
            void poller.refresh();
        }
    }

    return {
        runs,
        error,
        refresh: () => poller.refresh(),
        answer,
    };
}

/**
 * The run a token-less approval link (`?run=&approval=`) names, loaded
 * with `getRun` (steps dropped) when the link changes, on `refresh()` and
 * whenever `reload` changes (the view passes the inbox's runs, so the
 * link follows every inbox poll). `link` is the given link with the
 * approval pinned: a link without one keeps the approval the run waited
 * on when first loaded, so answering it never jumps to the run's next
 * approval. A failed reload keeps the run loaded earlier.
 */
export function useLinkedApproval(client: IApiClient, target: Ref<ApprovalLink | undefined>, reload?: Ref<unknown>) {
    const run = shallowRef<RunWire>();
    const error = shallowRef<ApiError>();
    const pinned = shallowRef<string>();
    let generation = 0;

    const link = computed<ApprovalLink | undefined>(() => {
        if (!target.value) {
            return undefined;
        }

        const approvalId = target.value.approvalId ?? pinned.value;

        return approvalId ? { runId: target.value.runId, approvalId } : { runId: target.value.runId };
    });

    async function load(): Promise<void> {
        const { value } = target;
        const current = ++generation;

        if (!value) {
            return;
        }

        try {
            const detail: Partial<RunDetail> = { ...await client.getRun(value.runId) };

            delete detail.steps;

            if (current !== generation) {
                return;
            }

            run.value = detail as RunWire;
            error.value = undefined;

            if (!value.approvalId && !pinned.value) {
                pinned.value = run.value.waiting?.approvalId;
            }
        } catch (e) {
            if (current !== generation) {
                return;
            }

            error.value = asApiError(e);
        }
    }

    watch(() => [target.value?.runId, target.value?.approvalId], () => {
        run.value = undefined;
        error.value = undefined;
        pinned.value = undefined;
        void load();
    }, { immediate: true });

    if (reload) {
        watch(reload, () => {
            void load();
        });
    }

    return {
        run,
        error,
        link,
        refresh: load,
    };
}
