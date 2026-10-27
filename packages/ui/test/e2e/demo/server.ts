/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { z } from 'zod';
import {
    Engine,
    MemoryStore,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { cron, cronChannel } from '@chamvi/channel-cron';
import {
    createHttpApp,
    http,
    httpChannel,
    mcpChannel,
    staticTokens,
} from '@chamvi/http';
import { uiRoutes } from '@chamvi/ui';
import { serve } from 'routup';
import { E2E_PORT, E2E_TOKEN } from './constants.ts';
import { createDemoModel } from './model.ts';

/** Takes the approval messages (and drops them): the tests answer in the dashboard. */
const capture: IChannel = {
    name: 'capture',
    out: () => Promise.resolve(),
};

const store = new MemoryStore();

const engine = new Engine({
    store,
    agents: [
        defineAgent({
            name: 'deploy',
            model: createDemoModel(),
            instructions: 'Deploy the requested environment.',
            channels: [http.on()],
            tools: {
                deploy: defineTool({
                    description: 'Deploy an environment.',
                    inputSchema: z.object({ env: z.string() }),
                    execute: async ({ env }, { context }) => {
                        const decision = await context.channels.findOneOrFail('capture').approve({
                            title: `Deploy ${env}?`,
                            body: `Rolls the demo release out to ${env}.`,
                            address: 'ops',
                        });
                        return decision.approved ? { deployed: env } : { denied: decision.reason ?? 'denied' };
                    },
                }),
            },
        }),
        defineAgent({
            name: 'release',
            model: createDemoModel(120, 'pick_version', {}),
            instructions: 'Release the version the owner picks.',
            channels: [http.on()],
            tools: {
                pick_version: defineTool({
                    description: 'Ask which version to release.',
                    inputSchema: z.object({}),
                    execute: async (_input, { context }) => {
                        const decision = await approve(context, {
                            title: 'Release which version?',
                            options: [
                                {
                                    id: '1.4.0',
                                    label: 'Minor 1.4.0',
                                    detail: '@@ -1 +1 @@\n-"version": "1.3.2"\n+"version": "1.4.0"',
                                },
                                { id: '2.0.0', label: 'Major 2.0.0' },
                            ],
                        });
                        return { released: decision.selected?.[0] ?? null };
                    },
                }),
            },
        }),
        defineAgent({
            name: 'digest',
            model: createDemoModel(),
            instructions: 'Write the morning digest.',
            channels: [cron.on('0 8 * * 1-5', { timezone: 'Europe/Berlin' })],
            state: { sent: z.object({ issues: z.number(), channel: z.string() }) },
        }),
    ],
    channels: [httpChannel(), mcpChannel(), cronChannel(), capture],
    claimTtlMs: 3000,
});

await store.kvSet('digest', 'last_digest_at', '2026-10-21T06:00:12.481Z');
await store.kvSet('digest', 'recipients', ['#maintainers']);
await store.docUpsert('digest', 'sent', '2026-10-21', { issues: 14, channel: '#maintainers' });

const app = createHttpApp({
    engine,
    auth: [staticTokens({
        tokens: [{
            value: E2E_TOKEN,
            id: 'e2e',
            permissions: ['*'],
        }],
    })],
    metrics: false,
    routes: uiRoutes(),
});

await engine.start();
serve(app, {
    port: E2E_PORT,
    hostname: '127.0.0.1',
    gracefulShutdown: false,
});
