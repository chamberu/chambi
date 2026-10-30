/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Run } from '@chamvi/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineCoreHandler } from 'routup';
import type { App, IAppEvent } from 'routup';
import { requireAgent } from '../agents/helpers.ts';
import type { HttpContext } from '../app/types.ts';
import { authenticate, authorize, toInvoker } from '../auth/helpers.ts';
import { Permission } from '../auth/constants.ts';
import { agentPermission } from '../auth/module.ts';
import { HTTP_CHANNEL_NAME } from '../channels/constants.ts';
import {
    readIdempotencyHeader,
    readJsonBody,
    validateBody,
    validatePayload,
} from '../request/helpers.ts';
import {
    assertCanListRuns,
    contentDisposition,
    createApproveContainer,
    createStartRunContainer,
    loadApprovableRun,
    loadReadableRun,
    loadRunArtifact,
    parseRunListQuery,
    requireHttpSubscription,
    serializeRun,
    serializeStep,
    toBody,
} from './helpers.ts';
import { streamRun } from './stream/module.ts';

function param(event: IAppEvent, name: string): string {
    return event.params[name] ?? '';
}

/** The run, once the principal may read it: 401, then 404, then 403. */
async function readableRun(event: IAppEvent, ctx: HttpContext, id: string): Promise<Run> {
    return loadReadableRun(ctx, await authenticate(event, ctx), id);
}

/**
 * `POST /agents/:name/runs`, `GET /runs`, `GET /runs/:id`, `GET /runs/:id/stream`,
 * `GET /runs/:id/artifacts`, `GET /runs/:id/artifacts/:artifactId`, `POST /runs/:id/cancel`, `POST /runs/:id/approve`.
 */
export function registerRunRoutes(app: App, ctx: HttpContext): void {
    const startContainer = createStartRunContainer();
    const approveContainer = createApproveContainer();

    app.post('/agents/:name/runs', defineCoreHandler(async (event) => {
        const name = param(event, 'name');
        const principal = await authorize(event, ctx, agentPermission(name, 'run'));
        const subscription = requireHttpSubscription(requireAgent(ctx.agents, name));

        const body = await validateBody(startContainer, await readJsonBody(event, ctx.bodyLimit));
        const idempotencyKey = body.idempotencyKey ?? readIdempotencyHeader(event.request);
        const payload = await validatePayload(subscription.options.schema as StandardSchemaV1 | undefined, body.payload);

        const result = await ctx.engine.dispatch({
            agent: name,
            trigger: subscription.id,
            channel: HTTP_CHANNEL_NAME,
            payload,
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
            ...(body.address !== undefined ? { address: body.address } : {}),
            ...(body.attachments?.length ? { attachments: body.attachments } : {}),
            invoker: toInvoker(principal),
        });
        event.response.status = 202;
        return result;
    }));

    app.get('/runs', defineCoreHandler(async (event) => {
        const principal = await authenticate(event, ctx);
        const query = parseRunListQuery(event.searchParams, ctx.agents.names());
        assertCanListRuns(principal, query.agent);

        const { data, total } = await ctx.store.runs.find(query);
        return {
            data: data.map(serializeRun),
            meta: {
                total,
                limit: query.limit,
                offset: query.offset,
            },
        };
    }));

    app.get('/runs/:id', defineCoreHandler(async (event) => {
        const run = await readableRun(event, ctx, param(event, 'id'));
        return { ...serializeRun(run), steps: (await ctx.store.steps.find(run.id)).map(serializeStep) };
    }));

    app.get('/runs/:id/stream', defineCoreHandler(async (event) => {
        const run = await readableRun(event, ctx, param(event, 'id'));
        return streamRun(event, ctx, run.id);
    }));

    app.get('/runs/:id/artifacts', defineCoreHandler(async (event) => {
        const run = await readableRun(event, ctx, param(event, 'id'));
        return { data: await ctx.store.artifacts.find(run.id) };
    }));

    app.get('/runs/:id/artifacts/:artifactId', defineCoreHandler(async (event) => {
        const run = await readableRun(event, ctx, param(event, 'id'));
        const { artifact, data } = await loadRunArtifact(ctx, run, param(event, 'artifactId'));
        // from the response headers, so CORS and RateLimit-* survive
        const headers = new Headers(event.response.headers);
        headers.set('content-type', artifact.mediaType);
        headers.set('content-length', String(data.byteLength));
        headers.set('content-disposition', contentDisposition(artifact.filename));
        // a stored text/html or image/svg+xml must never render as a page of this origin
        headers.set('x-content-type-options', 'nosniff');
        headers.set('cache-control', 'private, no-store');
        return new Response(toBody(data), { status: 200, headers });
    }));

    app.post('/runs/:id/cancel', defineCoreHandler(async (event) => {
        await authorize(event, ctx, Permission.RUN_CANCEL);
        const id = param(event, 'id');
        await ctx.engine.cancel(id);
        const run = await ctx.engine.getRun(id);
        event.response.status = 202;
        return { runId: id, status: run?.status };
    }));

    app.post('/runs/:id/approve', defineCoreHandler(async (event) => {
        // authorize against the run's agent before reading the body
        const principal = await authenticate(event, ctx);
        const run = await loadApprovableRun(ctx, principal, param(event, 'id'));
        const body = await validateBody(approveContainer, await readJsonBody(event, ctx.bodyLimit), { required: true });
        await ctx.engine.approve(run.id, {
            approvalId: body.approvalId,
            approved: body.approved,
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
            ...(body.selected !== undefined ? { selected: body.selected } : {}),
            approver: toInvoker(principal),
        });
        event.response.status = 202;
        return { runId: run.id, status: 'queued' };
    }));
}
