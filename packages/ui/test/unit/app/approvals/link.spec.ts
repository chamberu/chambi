/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import { createMemoryHistory } from 'vue-router';
import type { RunWire } from '../../../../app/api/types.ts';
import { useLinkedApproval } from '../../../../app/approvals/composables.ts';
import {
    approvalLinkQuery,
    linkNotice,
    linkedApprovalState,
    readApprovalLink,
} from '../../../../app/approvals/helpers.ts';
import type { ApprovalLink, DecidedApproval } from '../../../../app/approvals/types.ts';
import { RETURN_STORAGE_KEY } from '../../../../app/auth/constants.ts';
import { createAuthGuard } from '../../../../app/auth/guard.ts';
import { safeReturnPath } from '../../../../app/auth/helpers.ts';
import { createSession } from '../../../../app/auth/module.ts';
import type { IAuthupAdapter } from '../../../../app/auth/types.ts';
import { DEV_CONFIG } from '../../../../app/config/constants.ts';
import { RouteName } from '../../../../app/router/constants.ts';
import { createUiRouter } from '../../../../app/router/module.ts';
import {
    ME,
    apiError,
    fakeClient,
    meFor,
} from '../../../utils/client.ts';
import { wireRun } from '../../../utils/runs.ts';
import { MemoryStorage } from '../../../utils/storage.ts';
import { flush } from '../../../utils/timers.ts';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');

const waitingRun = (approvalId = 'a1', overrides: Partial<RunWire> = {}) => wireRun({
    id: 'r1',
    agent: 'deploy',
    status: 'waiting',
    waiting: {
        kind: 'approval',
        approvalId,
        toolName: 'deploy',
        toolCallId: 'call-1',
        title: 'Deploy prod?',
        expiresAt: '2026-10-22T10:00:00.000Z',
    },
    ...overrides,
});

function state(input: {
    link?: ApprovalLink;
    run?: RunWire;
    error?: ReturnType<typeof apiError>;
    decided?: DecidedApproval[];
    permissions?: string[];
}) {
    return linkedApprovalState({
        link: input.link ?? { runId: 'r1', approvalId: 'a1' },
        run: input.run,
        error: input.error,
        decided: input.decided ?? [],
        permissions: input.permissions ?? ['agent:deploy:approve'],
        now: NOW,
    });
}

describe('readApprovalLink', () => {
    it('reads run and approval from the query', () => {
        expect(readApprovalLink({ run: 'r1', approval: 'a1' })).toEqual({ runId: 'r1', approvalId: 'a1' });
    });

    it('takes the approval as optional', () => {
        expect(readApprovalLink({ run: 'r1' })).toEqual({ runId: 'r1' });
        expect(readApprovalLink({ run: 'r1', approval: '' })).toEqual({ runId: 'r1' });
    });

    it('takes the first non-empty value of a repeated key', () => {
        expect(readApprovalLink({ run: ['', 'r2', 'r3'], approval: [null, 'a2'] })).toEqual({ runId: 'r2', approvalId: 'a2' });
    });

    it('is undefined without a run', () => {
        expect(readApprovalLink({})).toBeUndefined();
        expect(readApprovalLink({ run: '' })).toBeUndefined();
        expect(readApprovalLink({ approval: 'a1' })).toBeUndefined();
        expect(readApprovalLink({ run: null })).toBeUndefined();
    });
});

describe('approvalLinkQuery', () => {
    it('names the run and its current approval', () => {
        expect(approvalLinkQuery(waitingRun('a7'))).toEqual({ run: 'r1', approval: 'a7' });
        expect(approvalLinkQuery(wireRun({ id: 'r9' }))).toEqual({ run: 'r9' });
    });
});

describe('linkedApprovalState', () => {
    it('is pending while the run waits on the linked approval', () => {
        expect(state({ run: waitingRun() })).toEqual({ kind: 'pending', run: waitingRun() });
    });

    it('is pending on the current approval when the link names none', () => {
        expect(state({ link: { runId: 'r1' }, run: waitingRun('a9') }).kind).toBe('pending');
    });

    it('is loading until the run arrived', () => {
        expect(state({})).toEqual({ kind: 'loading' });
    });

    it('is forbidden without agent:<agent>:approve', () => {
        expect(state({ run: waitingRun(), permissions: ['run:read', 'agent:other:approve'] })).toEqual({ kind: 'forbidden', run: waitingRun() });
        expect(state({ run: waitingRun(), permissions: ['agent:*:approve'] }).kind).toBe('pending');
    });

    it('is moved-on once the run no longer waits', () => {
        const run = wireRun({ id: 'r1', status: 'completed' });

        expect(state({ run })).toEqual({
            kind: 'moved-on',
            reason: 'not-waiting',
            run,
        });
    });

    it('is moved-on when the run waits on another approval', () => {
        const run = waitingRun('a2');

        expect(state({ run })).toEqual({
            kind: 'moved-on',
            reason: 'other-approval',
            run,
        });
    });

    it('is moved-on when the approval expired', () => {
        const run = waitingRun('a1', {});

        run.waiting!.expiresAt = '2026-10-21T11:59:59.000Z';
        expect(state({ run })).toMatchObject({ kind: 'moved-on', reason: 'expired' });
    });

    it('is answered once this page answered it, even before the run reloads', () => {
        const decided: DecidedApproval[] = [{
            run: waitingRun(),
            result: 'answered',
            approved: true,
        }];

        expect(state({ run: waitingRun(), decided }).kind).toBe('answered');
        expect(state({ run: wireRun({ id: 'r1', status: 'queued' }), decided }).kind).toBe('answered');
        // a refused answer does not count
        expect(state({ run: wireRun({ id: 'r1', status: 'queued' }), decided: [{ ...decided[0]!, result: 'already-answered' }] }).kind).toBe('moved-on');
    });

    it('maps a 404 to not-found and a 403 to unreadable', () => {
        expect(state({ error: apiError(404, 'run_not_found') })).toEqual({ kind: 'not-found' });
        expect(state({ error: apiError(403, 'forbidden') })).toEqual({ kind: 'unreadable' });
        expect(state({ error: apiError(500, 'boom') })).toEqual({ kind: 'failed', message: 'boom' });
    });

    it('keeps the last run over a later failed reload', () => {
        expect(state({ run: waitingRun(), error: apiError(503, 'service_unavailable') }).kind).toBe('pending');
    });
});

describe('linkNotice', () => {
    const link = { runId: 'r1', approvalId: 'a1' };

    it('says nothing while loading, pending or answered', () => {
        expect(linkNotice({ kind: 'loading' }, link)).toBeUndefined();
        expect(linkNotice({ kind: 'pending', run: waitingRun() }, link)).toBeUndefined();
        expect(linkNotice({ kind: 'answered', run: waitingRun() }, link)).toBeUndefined();
    });

    it('is a 403 naming the grant when the principal may not answer', () => {
        const notice = linkNotice({ kind: 'forbidden', run: waitingRun() }, link);

        expect(notice).toMatchObject({ status: 403, runId: 'r1' });
        expect(notice?.text).toContain('agent:deploy:approve');
    });

    it('is a 403 when the run is not readable', () => {
        const notice = linkNotice({ kind: 'unreadable' }, link);

        expect(notice).toMatchObject({ status: 403 });
        expect(notice?.runId).toBeUndefined();
        expect(notice?.text).toContain('run:read');
    });

    it('links the run when it moved on', () => {
        const done = linkNotice({
            kind: 'moved-on',
            reason: 'not-waiting',
            run: wireRun({ id: 'r1', status: 'completed' }),
        }, link);

        expect(done).toMatchObject({ runId: 'r1' });
        expect(done?.status).toBeUndefined();
        expect(done?.text).toContain('completed');
        expect(linkNotice({
            kind: 'moved-on',
            reason: 'other-approval',
            run: waitingRun('a2'),
        }, link)?.text).toContain('another approval');
        expect(linkNotice({
            kind: 'moved-on',
            reason: 'expired',
            run: waitingRun(),
        }, link)?.text).toContain('expired');
    });

    it('names a run that is not found', () => {
        expect(linkNotice({ kind: 'not-found' }, link)?.text).toContain('r1');
        expect(linkNotice({ kind: 'failed', message: 'boom' }, link)?.text).toContain('boom');
    });
});

describe('useLinkedApproval', () => {
    it('loads the linked run without its steps and reloads on demand', async () => {
        let calls = 0;
        const client = fakeClient({
            getRun: async (id) => {
                calls++;
                expect(id).toBe('r1');

                return { ...waitingRun(), steps: [] };
            },
        });
        const scope = effectScope();
        const linked = scope.run(() => useLinkedApproval(client, ref<ApprovalLink | undefined>({ runId: 'r1', approvalId: 'a1' })))!;

        await flush();
        expect(linked.run.value?.id).toBe('r1');
        expect(linked.run.value).not.toHaveProperty('steps');
        await linked.refresh();
        expect(calls).toBe(2);
        scope.stop();
    });

    it('pins the approval a link without one found first', async () => {
        let current = waitingRun();
        const client = fakeClient({ getRun: async () => ({ ...current, steps: [] }) });
        const scope = effectScope();
        const linked = scope.run(() => useLinkedApproval(client, ref<ApprovalLink | undefined>({ runId: 'r1' })))!;

        await flush();
        expect(linked.link.value).toEqual({ runId: 'r1', approvalId: 'a1' });
        current = waitingRun('a2');
        await linked.refresh();
        expect(linked.link.value).toEqual({ runId: 'r1', approvalId: 'a1' });
        scope.stop();
    });

    it('reloads whenever the trigger changes', async () => {
        let calls = 0;
        const client = fakeClient({
            getRun: async () => {
                calls++;

                return { ...waitingRun(), steps: [] };
            },
        });
        const tick = shallowRef(0);
        const scope = effectScope();

        scope.run(() => useLinkedApproval(client, ref<ApprovalLink | undefined>({ runId: 'r1' }), tick));
        await flush();
        tick.value++;
        await flush();
        expect(calls).toBe(2);
        scope.stop();
    });

    it('keeps the error of a run it cannot read and loads nothing without a link', async () => {
        const client = fakeClient({
            getRun: async () => {
                throw apiError(403, 'forbidden');
            },
        });
        const scope = effectScope();
        const target = ref<ApprovalLink | undefined>({ runId: 'r1' });
        const linked = scope.run(() => useLinkedApproval(client, target))!;

        await flush();
        expect(linked.error.value?.status).toBe(403);
        target.value = undefined;
        await flush();
        expect(linked.run.value).toBeUndefined();
        expect(linked.error.value).toBeUndefined();
        expect(linked.link.value).toBeUndefined();
        scope.stop();
    });
});

describe('the approval link across sign-in', () => {
    function setup(storage = new MemoryStorage(), authup?: IAuthupAdapter) {
        const session = createSession(
            authup ? { ...DEV_CONFIG, auth: { ...DEV_CONFIG.auth, authup: { url: 'https://authup.example', clientId: 'ui' } } } : DEV_CONFIG,
            {
                storage,
                client: () => fakeClient({ me: meFor('good') }),
                ...(authup ? { authup: async () => authup, navigate: () => {} } : {}),
            },
        );
        const router = createUiRouter(
            DEV_CONFIG,
            [createAuthGuard(session)],
            createMemoryHistory('/ui'),
        );

        return { router, session };
    }

    it('sends a signed-out visit to login with run and approval in the return path', async () => {
        const { router } = setup();

        await router.push('/approvals?run=r1&approval=a1');
        expect(router.currentRoute.value.name).toBe(RouteName.LOGIN);
        expect(router.currentRoute.value.query.redirect).toBe('/approvals?run=r1&approval=a1');
        expect(safeReturnPath(router.currentRoute.value.query.redirect)).toBe('/approvals?run=r1&approval=a1');
    });

    it('comes back to the same link after the token form', async () => {
        const { router, session } = setup();

        await router.push('/approvals?run=r1&approval=a1');
        await session.signInWithToken('good');
        await router.replace(safeReturnPath(router.currentRoute.value.query.redirect));
        expect(router.currentRoute.value.name).toBe(RouteName.APPROVALS);
        expect(router.currentRoute.value.query).toEqual({ run: 'r1', approval: 'a1' });
    });

    it('comes back to the same link after the authup round-trip', async () => {
        const storage = new MemoryStorage();
        let token: string | undefined;
        const authup: IAuthupAdapter = {
            start: async () => 'https://authup.example/authorize',
            complete: async () => {
                token = 'good';
            },
            token: async () => token,
            refresh: async () => false,
            signOut: async () => {},
        };
        const { router, session } = setup(storage, authup);

        await router.push('/approvals?run=r1&approval=a1');
        await session.startAuthup(safeReturnPath(router.currentRoute.value.query.redirect));
        expect(storage.getItem(RETURN_STORAGE_KEY)).toBe('/approvals?run=r1&approval=a1');

        const returnTo = await session.completeAuthup({ code: 'c', state: 's' });

        await router.replace(returnTo);
        expect(router.currentRoute.value.name).toBe(RouteName.APPROVALS);
        expect(router.currentRoute.value.query).toEqual({ run: 'r1', approval: 'a1' });
        expect(session.principal.value).toEqual(ME);
    });
});
