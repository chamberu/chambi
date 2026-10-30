/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunTestApp,
    tokenFor,
} from '../../utils/app.ts';
import { callTool, connectMcp, textOf } from '../../utils/mcp.ts';

type Setup = ReturnType<typeof createRunTestApp>;

async function start(setup: Setup, agent: string): Promise<string> {
    const response = await call(setup.app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN });

    return (await response.json() as { runId: string }).runId;
}

describe('mcp read tools', () => {
    it('lists get_run and list_runs', async () => {
        const setup = createRunTestApp();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const { tools } = await client.listTools();

        expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_run', 'list_runs']));
        await client.close();
    });

    it('get_run returns the run without its claim', async () => {
        const setup = createRunTestApp();
        const runId = await start(setup, 'echo');

        await setup.engine.start();
        await setup.engine.idle();

        const client = await connectMcp(setup.app, READER_TOKEN);
        const result = await callTool(client, 'get_run', { runId });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({
            id: runId,
            agent: 'echo',
            status: 'completed',
        });
        expect(result.structuredContent).not.toHaveProperty('claim');
        expect(JSON.parse(textOf(result))).toMatchObject({ id: runId });
        await client.close();
        await setup.engine.drain();
    });

    it('get_run on an unknown run is a tool error', async () => {
        const setup = createRunTestApp();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const result = await callTool(client, 'get_run', { runId: 'nope' });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('Run "nope" was not found.');
        await client.close();
    });

    it('list_runs filters by agent and pages 50 by default', async () => {
        const setup = createRunTestApp();

        await start(setup, 'gate');

        for (let i = 0; i < 51; i++) {
            await start(setup, 'echo');
        }

        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const gate = await callTool(client, 'list_runs', { agent: 'gate' });

        expect(gate.structuredContent).toMatchObject({ total: 1 });

        const all = await callTool(client, 'list_runs', { agent: 'echo' });
        const content = all.structuredContent as { data: Array<Record<string, unknown>>; total: number };

        expect(content.total).toBe(51);
        expect(content.data).toHaveLength(50);
        expect(Object.keys(content.data[0]!).sort()).toEqual(['agent', 'createdAt', 'id', 'status']);

        const queued = await callTool(client, 'list_runs', {
            status: ['completed'],
            limit: 5,
            offset: 0,
        });

        expect(queued.structuredContent).toMatchObject({ total: 0, data: [] });
        await client.close();
    });

    it('list_runs rejects a limit above 100', async () => {
        const setup = createRunTestApp();
        const client = await connectMcp(setup.app, ADMIN_TOKEN);
        const result = await callTool(client, 'list_runs', { limit: 101 });

        expect(result.isError).toBe(true);
        await client.close();
    });

    it('lets agent:<agent>:run read that agent only', async () => {
        const setup = createRunTestApp();
        const echo = await start(setup, 'echo');
        const gate = await start(setup, 'gate');

        const client = await connectMcp(setup.app, tokenFor('agent:echo:run'));

        expect((await callTool(client, 'get_run', { runId: echo })).isError).toBeFalsy();

        const denied = await callTool(client, 'get_run', { runId: gate });

        expect(denied.isError).toBe(true);
        expect(textOf(denied)).toBe('Missing permission "run:read".');

        const unfiltered = await callTool(client, 'list_runs', {});

        expect(unfiltered.isError).toBe(true);
        expect(textOf(unfiltered)).toBe('Missing permission "run:read".');

        expect((await callTool(client, 'list_runs', { agent: 'gate' })).isError).toBe(true);
        expect((await callTool(client, 'list_runs', { agent: 'echo' })).structuredContent).toMatchObject({ total: 1 });
        await client.close();
    });

    it('denies a principal without permissions', async () => {
        const setup = createRunTestApp();
        const runId = await start(setup, 'echo');
        const client = await connectMcp(setup.app, tokenFor());
        const result = await callTool(client, 'get_run', { runId });

        expect(result.isError).toBe(true);
        await client.close();
    });
});
