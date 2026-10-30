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
import { callTool, connectMcp, textOf } from '../../utils/mcp.ts';

async function waitingGate(agent = 'gate') {
    const setup = createRunTestApp();
    const response = await call(setup.app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN });
    const { runId } = await response.json() as { runId: string };

    await setup.engine.start();
    await setup.engine.idle();

    const run = await setup.store.runs.findOne(runId);

    expect(run?.status).toBe('waiting');

    return {
        ...setup,
        runId,
        approvalId: run!.waiting!.approvalId,
    };
}

describe('mcp approve_run', () => {
    it('answers the approval a waiting run waits on, once', async () => {
        const setup = await waitingGate();
        const client = await connectMcp(setup.app, tokenFor('agent:gate:approve'));
        const args = {
            runId: setup.runId,
            approvalId: setup.approvalId,
            approved: true,
        };
        const result = await callTool(client, 'approve_run', args);

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({ runId: setup.runId, status: 'queued' });

        await setup.engine.idle();
        expect((await setup.store.runs.findOne(setup.runId))?.status).toBe('completed');

        const again = await callTool(client, 'approve_run', args);

        expect(again.isError).toBe(true);
        await client.close();
        await setup.engine.drain();
    });

    it('needs agent:<agent>:approve', async () => {
        const setup = await waitingGate();
        const client = await connectMcp(setup.app, tokenFor('agent:echo:approve', 'run:read'));
        const result = await callTool(client, 'approve_run', {
            runId: setup.runId,
            approvalId: setup.approvalId,
            approved: true,
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('Missing permission "agent:gate:approve".');
        expect((await setup.store.runs.findOne(setup.runId))?.status).toBe('waiting');
        await client.close();
        await setup.engine.drain();
    });

    it('refuses another approval id than the run waits on', async () => {
        const setup = await waitingGate();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const result = await callTool(client, 'approve_run', {
            runId: setup.runId,
            approvalId: 'other',
            approved: false,
        });

        expect(result.isError).toBe(true);
        expect((await setup.store.runs.findOne(setup.runId))?.status).toBe('waiting');
        await client.close();
        await setup.engine.drain();
    });

    it('validates its arguments', async () => {
        const setup = createRunTestApp();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);

        expect((await callTool(client, 'approve_run', {
            runId: 'r',
            approvalId: 'a',
            approved: 'yes',
        })).isError).toBe(true);
        expect((await callTool(client, 'approve_run', { runId: 'r', approved: true })).isError).toBe(true);
        expect((await callTool(client, 'approve_run', {
            runId: 'r',
            approvalId: 'a',
            approved: true,
            reason: 'r'.repeat(1_001),
        })).isError).toBe(true);
        await client.close();
    });

    it('answers a choice with selected', async () => {
        const setup = await waitingGate('choose');
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const refused = await callTool(client, 'approve_run', {
            runId: setup.runId,
            approvalId: setup.approvalId,
            approved: true,
            selected: [1],
        });

        expect(refused.isError).toBe(true);

        const result = await callTool(client, 'approve_run', {
            runId: setup.runId,
            approvalId: setup.approvalId,
            approved: true,
            selected: ['a'],
        });

        expect(result.isError).toBeFalsy();
        await setup.engine.idle();

        const steps = await setup.store.steps.find(setup.runId);

        expect(steps.find((s) => s.kind === 'wait')?.output).toMatchObject({ selected: ['a'] });
        await client.close();
        await setup.engine.drain();
    });
});
