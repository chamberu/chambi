/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import type { ApproveBody, RunListFilter } from '../../../../app/api/types.ts';
import { useApprovals } from '../../../../app/approvals/composables.ts';
import { apiError, fakeClient } from '../../../utils/client.ts';
import { wireRun } from '../../../utils/runs.ts';
import { flush } from '../../../utils/timers.ts';

const waitingRun = (id = 'r1', approvalId = 'a1') => wireRun({
    id,
    status: 'waiting',
    waiting: {
        kind: 'approval',
        approvalId,
        toolName: 'deploy',
        toolCallId: 'call-1',
        title: 'Deploy prod?',
        expiresAt: '2026-10-22T10:00:00.000Z',
    },
});

function inboxClient(approve: (id: string, body: ApproveBody) => Promise<void>) {
    const queries: RunListFilter[] = [];
    let lists = 0;
    const client = fakeClient({
        listRuns: async (filter) => {
            queries.push(filter);
            lists++;

            return {
                data: [waitingRun()],
                meta: {
                    total: 1,
                    limit: 100,
                    offset: 0,
                },
            };
        },
        approve,
    });

    return {
        client,
        queries,
        lists: () => lists,
    };
}

describe('useApprovals', () => {
    it('lists the waiting runs newest first', async () => {
        const { client, queries } = inboxClient(async () => {});
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();
        expect(queries[0]).toEqual({
            status: ['waiting'],
            limit: 100,
            offset: 0,
        });
        expect(inbox.runs.value.map((run) => run.id)).toEqual(['r1']);
        scope.stop();
    });

    it('sends the selection with an approval', async () => {
        const answered: Array<[string, ApproveBody]> = [];
        const { client } = inboxClient(async (id, body) => {
            answered.push([id, body]);
        });
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();
        await inbox.answer(waitingRun(), true, '', ['b']);
        await inbox.answer(waitingRun(), false, 'no', ['b']);
        await inbox.answer(waitingRun(), true, '', []);
        expect(answered).toEqual([
            ['r1', {
                approvalId: 'a1',
                approved: true,
                selected: ['b'],
            }],
            ['r1', {
                approvalId: 'a1',
                approved: false,
                reason: 'no',
            }],
            ['r1', { approvalId: 'a1', approved: true }],
        ]);
        scope.stop();
    });

    it('answer approves the current approval id', async () => {
        const answered: Array<[string, ApproveBody]> = [];
        const { client } = inboxClient(async (id, body) => {
            answered.push([id, body]);
        });
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();
        expect(await inbox.answer(waitingRun(), false, 'not now')).toBe('answered');
        expect(answered).toEqual([['r1', {
            approvalId: 'a1',
            approved: false,
            reason: 'not now',
        }]]);
        expect(await inbox.answer(waitingRun(), true, '  ')).toBe('answered');
        expect(answered[1]).toEqual(['r1', { approvalId: 'a1', approved: true }]);
        scope.stop();
    });

    it('answer maps 409 to an already-answered result and refreshes', async () => {
        const { client, lists } = inboxClient(async () => {
            throw apiError(409, 'invalid_run_state');
        });
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();

        const before = lists();

        expect(await inbox.answer(waitingRun(), true)).toBe('already-answered');
        expect(lists()).toBe(before + 1);
        scope.stop();
    });

    it('answer maps 403 to forbidden', async () => {
        const { client } = inboxClient(async () => {
            throw apiError(403, 'forbidden');
        });
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();
        expect(await inbox.answer(waitingRun(), true)).toBe('forbidden');
        scope.stop();
    });

    it('answer rethrows anything else', async () => {
        const { client } = inboxClient(async () => {
            throw apiError(500, 'boom');
        });
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();
        await expect(inbox.answer(waitingRun(), true)).rejects.toMatchObject({ status: 500 });
        scope.stop();
    });

    it('keeps a 403 listing as error', async () => {
        const client = fakeClient({
            listRuns: async () => {
                throw apiError(403, 'forbidden');
            },
        });
        const scope = effectScope();
        const inbox = scope.run(() => useApprovals(client))!;

        await flush();
        expect(inbox.error.value?.status).toBe(403);
        expect(inbox.runs.value).toEqual([]);
        scope.stop();
    });
});

