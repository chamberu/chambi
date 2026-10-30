/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    READER_TOKEN,
    call,
    createTestApp,
    tokenFor,
} from '../../utils/app.ts';
import { inventoryAgents } from '../../utils/agents.ts';

describe('GET /agents', () => {
    it('summarizes every agent in definition order', async () => {
        const { app } = createTestApp({ agents: inventoryAgents() });
        const response = await call(app, 'GET', '/agents', { token: READER_TOKEN });

        expect(response.status).toBe(200);

        const { data } = await response.json();

        expect(data).toEqual([
            {
                name: 'echo',
                channels: [{ channel: 'http', id: 'http' }],
                budget: { maxSteps: 20, timeoutMs: 900_000 },
                state: [],
            },
            {
                name: 'intake',
                channels: [{
                    channel: 'webhook',
                    id: 'webhook:/issues',
                    hook: '/channels/webhook/intake/issues',
                }],
                budget: { maxSteps: 20, timeoutMs: 900_000 },
                state: ['issues'],
            },
        ]);
    });

    it('prefixes the hook path with basePath', async () => {
        const { app } = createTestApp({ agents: inventoryAgents(), basePath: '/api' });
        const { data } = await (await call(app, 'GET', '/api/agents', { token: READER_TOKEN })).json();

        expect(data[1].channels[0].hook).toBe('/api/channels/webhook/intake/issues');
    });

    it('builds the hook path from a basePath given with a trailing slash', async () => {
        const { app } = createTestApp({ agents: inventoryAgents(), basePath: '/api/' });
        const { data } = await (await call(app, 'GET', '/api/agents', { token: READER_TOKEN })).json();

        expect(data[1].channels[0].hook).toBe('/api/channels/webhook/intake/issues');
    });

    it('lists no hook for a webhook channel the http app does not mount', async () => {
        const { app } = createTestApp({ agents: inventoryAgents(), channels: [] });
        const { data } = await (await call(app, 'GET', '/agents', { token: READER_TOKEN })).json();

        expect(data[1].channels).toEqual([{ channel: 'webhook', id: 'webhook:/issues' }]);
    });

    it('needs run:read', async () => {
        const { app } = createTestApp({ agents: inventoryAgents() });

        expect((await call(app, 'GET', '/agents', { token: tokenFor() })).status).toBe(403);
        expect((await call(app, 'GET', '/agents', { token: tokenFor('agent:echo:run') })).status).toBe(403);
        expect((await call(app, 'GET', '/agents')).status).toBe(401);
    });

    it('lists no issues without agentIssues', async () => {
        const { app } = createTestApp({ agents: inventoryAgents() });
        const body = await (await call(app, 'GET', '/agents', { token: READER_TOKEN })).json();

        expect(body.issues).toEqual([]);
    });

    it('lists agentIssues', async () => {
        const at = new Date(1_000_000);
        const { app } = createTestApp({
            agents: inventoryAgents(),
            agentIssues: () => [{
                agent: 'broken',
                message: 'agent.yaml: model is missing',
                at,
            }],
        });
        const body = await (await call(app, 'GET', '/agents', { token: READER_TOKEN })).json();

        expect(body.issues).toEqual([{
            agent: 'broken',
            message: 'agent.yaml: model is missing',
            at: at.toISOString(),
        }]);
        expect(body.data.map((agent: { name: string }) => agent.name)).toEqual(['echo', 'intake']);
    });
});
