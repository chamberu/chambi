/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
} from 'vitest';
import {
    ADMIN_TOKEN,
    call,
    createRunTestApp,
    tokenFor,
} from '../../utils/app.ts';
import type { TestAppOverrides } from '../../utils/app.ts';

async function pausedGate(overrides: TestAppOverrides = {}, agent = 'gate') {
    const ctx = createRunTestApp(overrides);
    const response = await call(ctx.app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN });
    const { runId } = await response.json() as { runId: string };

    await ctx.engine.start();
    await ctx.engine.idle();

    const run = await ctx.store.runs.findOne(runId);

    expect(run?.status).toBe('waiting');

    return {
        ...ctx,
        runId,
        waiting: run!.waiting!,
    };
}

describe('POST /runs/:id/approve', () => {
    it('approves the current wait point and records the approver', async () => {
        const {
            app,
            engine,
            store,
            runId,
            waiting,
        } = await pausedGate();
        const approver = tokenFor('agent:gate:approve', 'run:read');
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: approver,
            body: { approvalId: waiting.approvalId, approved: true },
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ runId, status: 'queued' });
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('completed');

        const detail = await (await call(app, 'GET', `/runs/${runId}`, { token: approver })).json() as {
            steps: Array<{ kind: string; output: unknown }>;
        };
        const wait = detail.steps.find((step) => step.kind === 'wait');

        expect(wait?.output).toEqual({
            approvalId: waiting.approvalId,
            approved: true,
            approver: { id: 'p:agent:gate:approve,run:read', kind: 'token' },
        });
        await engine.drain();
    });

    it('denies with a reason', async () => {
        const {
            app,
            engine,
            store,
            runId,
            waiting,
        } = await pausedGate();
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: ADMIN_TOKEN,
            body: {
                approvalId: waiting.approvalId,
                approved: false,
                reason: 'not now',
            },
        });

        expect(response.status).toBe(202);
        await engine.idle();

        const steps = await store.steps.find(runId);

        expect(steps.find((step) => step.kind === 'wait')?.output).toMatchObject({ approved: false, reason: 'not now' });
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        await engine.drain();
    });

    it('409 for a stale approvalId', async () => {
        const {
            app,
            engine,
            store,
            runId,
        } = await pausedGate();
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: ADMIN_TOKEN,
            body: { approvalId: 'other', approved: true },
        });

        expect(response.status).toBe(409);
        expect((await response.json()).code).toBe('invalid_run_state');
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        await engine.drain();
    });

    it('409 for a run that is not waiting', async () => {
        const {
            app,
            engine,
            runId,
            waiting,
        } = await pausedGate();
        const body = { approvalId: waiting.approvalId, approved: true };

        expect((await call(app, 'POST', `/runs/${runId}/approve`, { token: ADMIN_TOKEN, body })).status).toBe(202);
        await engine.idle();

        const again = await call(app, 'POST', `/runs/${runId}/approve`, { token: ADMIN_TOKEN, body });

        expect(again.status).toBe(409);
        expect((await again.json()).code).toBe('invalid_run_state');
        await engine.drain();
    });

    it('404 before 403', async () => {
        const { app, engine } = createRunTestApp();
        const response = await call(app, 'POST', '/runs/unknown/approve', {
            token: tokenFor('run:read'),
            body: { approvalId: 'a', approved: true },
        });

        expect(response.status).toBe(404);
        await engine.drain();
    });

    it('401 without credentials', async () => {
        const {
            app,
            engine,
            runId,
        } = await pausedGate();
        const response = await call(app, 'POST', `/runs/${runId}/approve`, { body: { approvalId: 'a', approved: true } });

        expect(response.status).toBe(401);
        await engine.drain();
    });

    it('403 without agent:<agent>:approve', async () => {
        const {
            app,
            engine,
            store,
            runId,
            waiting,
        } = await pausedGate();
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: tokenFor('agent:gate:run', 'run:read'),
            body: { approvalId: waiting.approvalId, approved: true },
        });

        expect(response.status).toBe(403);
        expect((await response.json()).message).toBe('Missing permission "agent:gate:approve".');
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        await engine.drain();
    });

    it('authorizes before reading the body', async () => {
        const {
            app,
            engine,
            runId,
        } = await pausedGate({ bodyLimit: 1024 });
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: tokenFor('run:read'),
            body: { approvalId: 'a'.repeat(4096), approved: true },
        });

        expect(response.status).toBe(403);
        await engine.drain();
    });

    it.each([
        [{ approved: true }],
        [{ approvalId: 'a\0b', approved: true }],
        [{ approvalId: '', approved: true }],
        [{ approvalId: 'a'.repeat(256), approved: true }],
        [{ approvalId: 'a', approved: 'yes' }],
        [{
            approvalId: 'a',
            approved: true,
            reason: 'r'.repeat(1_001),
        }],
    ])('400 for body %#', async (body) => {
        const {
            app,
            engine,
            store,
            runId,
        } = await pausedGate();
        const response = await call(app, 'POST', `/runs/${runId}/approve`, { token: ADMIN_TOKEN, body });

        expect(response.status).toBe(400);
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        await engine.drain();
    });

    it('approves a choice with selected ids', async () => {
        const {
            app,
            engine,
            store,
            runId,
            waiting,
        } = await pausedGate({}, 'choose');
        const before = await call(app, 'GET', `/runs/${runId}`, { token: ADMIN_TOKEN });

        expect((await before.json()).waiting.options).toEqual([{ id: 'a', label: 'A' }, {
            id: 'b',
            label: 'B',
            detail: 'diff',
        }]);

        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: ADMIN_TOKEN,
            body: {
                approvalId: waiting.approvalId,
                approved: true,
                selected: ['b'],
            },
        });

        expect(response.status).toBe(202);
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('completed');

        const detail = await (await call(app, 'GET', `/runs/${runId}`, { token: ADMIN_TOKEN })).json();
        const wait = detail.steps.find((s: { kind: string }) => s.kind === 'wait');

        expect(wait.output.selected).toEqual(['b']);

        const tool = detail.steps.find((s: { kind: string; name?: string }) => s.kind === 'tool' && s.name === 'pick');

        expect(tool.output).toBe('picked b');
        await engine.drain();
    });

    it.each([
        ['an unknown id', 'choose', { approved: true, selected: ['z'] }],
        ['two ids for a single choice', 'choose', { approved: true, selected: ['a', 'b'] }],
        ['an approval without a selection', 'choose', { approved: true }],
        ['a selection on a plain wait point', 'gate', { approved: true, selected: ['a'] }],
    ])('400 for %s, the run still waiting', async (_, agent, answer) => {
        const {
            app,
            engine,
            store,
            runId,
            waiting,
        } = await pausedGate({}, agent);
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: ADMIN_TOKEN,
            body: { approvalId: waiting.approvalId, ...answer },
        });

        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe('validation_error');
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        await engine.drain();
    });

    it.each([
        ['a string', 'a'],
        ['21 items', Array.from({ length: 21 }, (_, i) => `o${i}`)],
        ['an item of 129 characters', ['x'.repeat(129)]],
        ['an empty item', ['']],
        ['an item that is no string', [1]],
    ])('400 from the body for selected as %s', async (_, selected) => {
        const {
            app,
            engine,
            store,
            runId,
            waiting,
        } = await pausedGate({}, 'choose');
        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: ADMIN_TOKEN,
            body: {
                approvalId: waiting.approvalId,
                approved: true,
                selected,
            },
        });

        expect(response.status).toBe(400);

        const json = await response.json();

        expect(json.code).toBe('validation_error');
        expect(JSON.stringify(json.issues)).toContain('selected');
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        await engine.drain();
    });
});
