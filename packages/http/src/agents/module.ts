/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineCoreHandler } from 'routup';
import type { App, IAppEvent } from 'routup';
import type { HttpContext } from '../app/types.ts';
import { authorize } from '../auth/helpers.ts';
import { Permission } from '../auth/constants.ts';
import { isWebhookChannel } from '../channels/helpers.ts';
import { readJsonBody, validateBody } from '../request/helpers.ts';
import {
    assertCollection,
    createKvContainer,
    listSchedules,
    parseCollectionQuery,
    parseKvListQuery,
    requireAgent,
    serializeDoc,
    summarizeAgent,
} from './helpers.ts';

function param(event: IAppEvent, name: string): string {
    return event.params[name] ?? '';
}

/**
 * `GET /agents`, `GET /schedules`, `GET /agents/:name/state/kv`, `GET/PATCH /agents/:name/state/kv/:key`
 * and `GET /agents/:name/state/collections/:collection`.
 */
export function registerAgentRoutes(app: App, ctx: HttpContext): void {
    const kvContainer = createKvContainer();

    app.get('/agents', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.RUN_READ);

        const hookChannels = new Set(ctx.channels.filter(isWebhookChannel).map((channel) => channel.name));

        return {
            data: ctx.agents.list().map((agent) => summarizeAgent(agent, ctx.basePath, hookChannels)),
            issues: ctx.agentIssues(),
        };
    }));

    app.get('/schedules', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.RUN_READ);

        return { data: listSchedules(ctx.agents.list(), ctx.clock.now()) };
    }));

    app.get('/agents/:name/state/kv', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.STATE_READ);

        const agent = requireAgent(ctx.agents, param(event, 'name'));

        return { data: await ctx.store.state.find(agent.name, parseKvListQuery(event.searchParams)) };
    }));

    app.get('/agents/:name/state/kv/:key', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.STATE_READ);

        const agent = requireAgent(ctx.agents, param(event, 'name'));
        const key = param(event, 'key');
        const value = await ctx.store.state.findOne(agent.name, key);

        return { key, value: value ?? null };
    }));

    app.patch('/agents/:name/state/kv/:key', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.STATE_WRITE);

        const agent = requireAgent(ctx.agents, param(event, 'name'));
        const key = param(event, 'key');
        const body = await validateBody(kvContainer, await readJsonBody(event, ctx.bodyLimit), { required: true });

        await ctx.store.state.set(agent.name, key, body.value);

        return { key, value: body.value };
    }));

    app.get('/agents/:name/state/collections/:collection', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.STATE_READ);

        const agent = requireAgent(ctx.agents, param(event, 'name'));
        const collection = param(event, 'collection');

        assertCollection(agent, collection);

        const query = parseCollectionQuery(event.searchParams);
        const docs = await ctx.store.state.findDocuments(agent.name, collection, query);

        return { data: docs.map(serializeDoc) };
    }));
}
