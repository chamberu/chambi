/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    call,
    createRunTestApp,
    tokenFor,
} from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';

describe('mcp invoker', () => {
    it('run_<agent> records the principal as the invoker; get_run drops its permissions', async () => {
        const setup = createRunTestApp();
        const token = tokenFor('agent:echo:run');
        const client = await connectMcp(setup.app, token);
        const result = await callTool(client, 'run_echo', {});
        expect(result.isError).toBeFalsy();
        const { runId } = result.structuredContent as { runId: string };

        expect((await setup.store.runs.findOne(runId))?.trigger.invoker).toEqual({
            id: 'p:agent:echo:run',
            kind: 'token',
            permissions: ['agent:echo:run'],
        });

        const read = await callTool(client, 'get_run', { runId });
        expect(read.isError).toBeFalsy();
        expect((read.structuredContent as { trigger: { invoker: unknown } }).trigger.invoker).toEqual({
            id: 'p:agent:echo:run',
            kind: 'token',
        });
        await client.close();
    });

    it('approve_run records the approver on the wait step', async () => {
        const setup = createRunTestApp();
        const response = await call(setup.app, 'POST', '/agents/gate/runs', { token: tokenFor('agent:gate:run') });
        const { runId } = await response.json() as { runId: string };
        await setup.engine.start();
        await setup.engine.idle();

        const client = await connectMcp(setup.app, tokenFor('agent:gate:approve'));
        const result = await callTool(client, 'approve_run', {
            runId,
            approvalId: await setup.approvalIdOf(runId), 
            approved: false, 
            reason: 'no', 
        });
        expect(result.isError).toBeFalsy();
        await setup.engine.idle();

        const wait = (await setup.store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect((wait?.output as { approver?: unknown }).approver).toEqual({
            id: 'p:agent:gate:approve',
            kind: 'token',
            permissions: ['agent:gate:approve'],
        });
        await client.close();
        await setup.engine.drain();
    });
});
