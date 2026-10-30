/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import type { RunListFilter } from '../../../../app/api/types.ts';
import {
    useRunActivity,
    useRunCounts,
    useRunDetail,
    useRunList,
} from '../../../../app/runs/composables.ts';
import type { RunStreamEvent, RunStreamOptions } from '../../../../app/sse/types.ts';
import { apiError, fakeClient } from '../../../utils/client.ts';
import { wireRun, wireStep } from '../../../utils/runs.ts';
import { flush } from '../../../utils/timers.ts';

function fakeStreams() {
    const opened: Array<RunStreamOptions & { closed: boolean; emit: (event: RunStreamEvent) => void }> = [];
    const open = (options: RunStreamOptions) => {
        const entry = {
            ...options,
            closed: false,
            emit: (event: RunStreamEvent) => options.onEvent(event),
        };

        opened.push(entry);

        return {
            close: () => {
                entry.closed = true;
            },
        };
    };

    return { open, opened };
}

describe('useRunDetail', () => {
    it('loads, then streams after the last step', async () => {
        const client = fakeClient({ getRun: async () => ({ ...wireRun(), steps: [wireStep(0), wireStep(1, 'tool')] }) });
        const streams = fakeStreams();
        const scope = effectScope();
        const detail = scope.run(() => useRunDetail(client, ref('r1'), { openStream: streams.open }))!;

        await flush();
        expect(detail.state.value?.steps).toHaveLength(2);
        expect(streams.opened).toHaveLength(1);
        expect(streams.opened[0]).toMatchObject({ runId: 'r1', after: 1 });

        streams.opened[0]!.emit({ type: 'step', step: wireStep(2, 'wait') });
        streams.opened[0]!.emit({ type: 'run', run: wireRun({ status: 'waiting' }) });
        expect(detail.state.value?.steps.map((s) => s.index)).toEqual([0, 1, 2]);
        expect(detail.state.value?.run.status).toBe('waiting');
        expect(detail.live.value).toBe(true);
        scope.stop();
    });

    it('does not stream a settled run', async () => {
        const client = fakeClient({ getRun: async () => ({ ...wireRun({ status: 'completed' }), steps: [] }) });
        const streams = fakeStreams();
        const scope = effectScope();
        const detail = scope.run(() => useRunDetail(client, ref('r1'), { openStream: streams.open }))!;

        await flush();
        expect(detail.state.value?.run.status).toBe('completed');
        expect(streams.opened).toHaveLength(0);
        scope.stop();
    });

    it('closes the stream on scope dispose', async () => {
        const client = fakeClient({ getRun: async () => ({ ...wireRun(), steps: [] }) });
        const streams = fakeStreams();
        const scope = effectScope();

        scope.run(() => useRunDetail(client, ref('r1'), { openStream: streams.open }));
        await flush();
        scope.stop();
        expect(streams.opened[0]!.closed).toBe(true);
    });

    it('reloads and reopens on another run id', async () => {
        const client = fakeClient({ getRun: async (id) => ({ ...wireRun({ id }), steps: [] }) });
        const streams = fakeStreams();
        const id = ref('r1');
        const scope = effectScope();
        const detail = scope.run(() => useRunDetail(client, id, { openStream: streams.open }))!;

        await flush();
        id.value = 'r2';
        await nextTick();
        await flush();
        expect(streams.opened[0]!.closed).toBe(true);
        expect(streams.opened[1]!.runId).toBe('r2');
        expect(detail.state.value?.run.id).toBe('r2');
        scope.stop();
    });

    it('keeps a load error', async () => {
        const client = fakeClient({
            getRun: async () => {
                throw apiError(404, 'run_not_found');
            },
        });
        const scope = effectScope();
        const detail = scope.run(() => useRunDetail(client, ref('r1'), { openStream: fakeStreams().open }))!;

        await flush();
        expect(detail.error.value).toMatchObject({ status: 404 });
        scope.stop();
    });

    it('cancel asks the API', async () => {
        const cancelled: string[] = [];
        const client = fakeClient({
            getRun: async () => ({ ...wireRun(), steps: [] }),
            cancelRun: async (id) => {
                cancelled.push(id);
            },
        });
        const scope = effectScope();
        const detail = scope.run(() => useRunDetail(client, ref('r1'), { openStream: fakeStreams().open }))!;

        await flush();
        await detail.cancel();
        expect(cancelled).toEqual(['r1']);
        scope.stop();
    });
});

describe('useRunList', () => {
    it('re-queries when the filter changes', async () => {
        const seen: RunListFilter[] = [];
        const client = fakeClient({
            listRuns: async (filter) => {
                seen.push(filter);

                return {
                    data: [wireRun()],
                    meta: {
                        total: 1,
                        limit: 25,
                        offset: 0,
                    },
                };
            },
        });
        const filter = ref<RunListFilter>({ limit: 25, offset: 0 });
        const scope = effectScope();
        const list = scope.run(() => useRunList(client, filter))!;

        await flush();
        expect(list.page.value?.meta.total).toBe(1);
        filter.value = {
            agent: 'deploy',
            status: ['waiting'],
            limit: 25,
            offset: 0,
        };
        await nextTick();
        await flush();
        expect(seen.at(-1)).toEqual({
            agent: 'deploy',
            status: ['waiting'],
            limit: 25,
            offset: 0,
        });
        scope.stop();
    });

    it('keeps an error without throwing', async () => {
        const client = fakeClient({
            listRuns: async () => {
                throw apiError(403, 'forbidden');
            },
        });
        const scope = effectScope();
        const list = scope.run(() => useRunList(client, ref({})))!;

        await flush();
        expect(list.error.value).toMatchObject({ status: 403 });
        scope.stop();
    });
});

describe('useRunCounts', () => {
    it('reads every total in one pass on one poller', async () => {
        const seen: RunListFilter[] = [];
        const client = fakeClient({
            listRuns: async (filter) => {
                seen.push(filter);

                const total = {
                    running: 2,
                    waiting: 1,
                    failed: 0,
                }[filter.status![0] as string]!;

                return {
                    data: [],
                    meta: {
                        total,
                        limit: 1,
                        offset: 0,
                    },
                };
            },
        });
        const scope = effectScope();
        const { counts } = scope.run(() => useRunCounts(client, ['running', 'waiting', 'failed']))!;

        await flush();
        expect(counts.value).toEqual({
            running: 2,
            waiting: 1,
            failed: 0,
        });
        expect(seen).toEqual([
            { status: ['running'], limit: 1 },
            { status: ['waiting'], limit: 1 },
            { status: ['failed'], limit: 1 },
        ]);
        scope.stop();
    });

    it('keeps the last totals and the error when a pass fails', async () => {
        const client = fakeClient({
            listRuns: async () => {
                throw apiError(429, 'too_many_requests');
            },
        });
        const scope = effectScope();
        const { counts, error } = scope.run(() => useRunCounts(client, ['running']))!;

        await flush();
        expect(counts.value).toEqual({});
        expect(error.value).toMatchObject({ status: 429 });
        scope.stop();
    });
});

describe('useRunActivity', () => {
    it('summarizes the newest runs of every agent for the last 24 h', async () => {
        const seen: RunListFilter[] = [];
        const now = new Date().toISOString();
        const client = fakeClient({
            listRuns: async (filter) => {
                seen.push(filter);

                return {
                    data: [wireRun({
                        id: 'a',
                        status: 'failed',
                        createdAt: now,
                    }), wireRun({ id: 'b', createdAt: '2020-01-01T00:00:00.000Z' })],
                    meta: {
                        total: 2,
                        limit: 100,
                        offset: 0,
                    },
                };
            },
        });
        const scope = effectScope();
        const { activity } = scope.run(() => useRunActivity(client))!;

        await flush();
        expect(seen[0]).toEqual({ limit: 100, offset: 0 });
        expect(activity.value).toMatchObject({
            count: 1,
            failed: 1,
            saturated: false,
        });
        scope.stop();
    });
});
