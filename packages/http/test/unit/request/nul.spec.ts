/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { defineAgent } from '@chamvi/core';
import { webhook } from '@chamvi/http';
import {
    ADMIN_TOKEN,
    call,
    createRunAgents,
    createRunTestApp,
} from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';
import { textModel } from '../../utils/model.ts';

// Postgres varchar columns refuse U+0000, so it is refused at the edge as 400
describe('a NUL character', () => {
    it.each([
        ['GET', '/runs/a%00b'],
        ['POST', '/runs/a%00b/cancel'],
        ['GET', '/runs?filter[agent]=a%00b'],
        ['GET', '/agents/echo/state/kv/a%00b'],
        ['GET', '/agents/a%00b/state/collections/c'],
    ])('in %s %s answers 400', async (method, path) => {
        const { app } = createRunTestApp();
        const response = await call(app, method, path, { token: ADMIN_TOKEN });
        expect(response.status).toBe(400);
    });

    it.each(['idempotencyKey', 'address'])('in a REST %s answers 400', async (key) => {
        const { app, stores: store } = createRunTestApp();
        const response = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { [key]: 'a\u0000b' } });
        expect(response.status).toBe(400);
        expect((await store.runs.listRuns({})).total).toBe(0);
    });

    it('in a key a webhook derives from the payload answers 400', async () => {
        const agent = defineAgent({
            name: 'keyed',
            model: textModel(),
            instructions: 'Keyed.',
            channels: [webhook.on('/k', { concurrencyKey: (p) => String((p as { k: string }).k) })],
        });
        const { app } = createRunTestApp({ agents: [...createRunAgents(), agent] });
        const response = await call(app, 'POST', '/channels/webhook/keyed/k', { token: ADMIN_TOKEN, body: { k: 'a\u0000b' } });
        expect(response.status).toBe(400);
    });

    it.each([
        ['run_echo', { idempotencyKey: 'a\u0000b' }],
        ['run_echo', { address: 'a\u0000b' }],
        ['get_run', { runId: 'a\u0000b' }],
        ['list_runs', { agent: 'a\u0000b' }],
    ])('in MCP %s %j is a tool error', async (tool, args) => {
        const { app, stores: store } = createRunTestApp();
        const client = await connectMcp(app, ADMIN_TOKEN);
        const result = await callTool(client, tool, args);
        expect(result.isError).toBe(true);
        expect((await store.runs.listRuns({})).total).toBe(0);
        await client.close();
    });
});
