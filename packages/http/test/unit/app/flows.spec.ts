/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ITokenVerifier } from '@authup/server-adapter-kit';
import { staticKeys } from 'vouchly';
import type { OidcIssuer as Issuer, Principal  } from '@chamvi/http';
import {
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { defineAgent } from '@chamvi/core';
import { 
    authup, 
    createShutdown, 
    oidc, 
    staticTokens, 
    webhook, 
} from '@chamvi/http';
import type { Run, Step } from '@chamvi/core';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunAgents,
    createRunTestApp,
} from '../../utils/app.ts';
import type { TestAppOverrides } from '../../utils/app.ts';
import { createSigningKey, signToken } from '../../utils/jwt.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';
import { textModel } from '../../utils/model.ts';
import { SseReader } from '../../utils/sse.ts';

const ISSUER = 'https://issuer.test';

/** authup in remote mode: `approver` is a global token that may approve gate runs. */
const authupVerifier: ITokenVerifier = {
    verify: async (token) => {
        if (token !== 'approver') throw new Error('invalid_token');
        return {
            sub: 'approver',
            scope: 'global',
            permissions: [{ name: 'agent:gate:approve' }],
        };
    },
};

/** OpenClaw over OIDC: may run echo, nothing else. */
const openclaw = (claims: Record<string, unknown>): Principal | undefined => (claims.sub === 'openclaw' ?
    {
        id: 'openclaw',
        kind: 'oidc',
        permissions: ['agent:echo:run'],
    } :
    undefined);

describe('acceptance flows', () => {
    let signingKey: Awaited<ReturnType<typeof createSigningKey>>;
    let issuer: Issuer;

    beforeAll(async () => {
        signingKey = await createSigningKey();
        issuer = {
            id: 'local',
            issuer: ISSUER,
            audience: 'chamvi',
            keys: staticKeys([signingKey.jwk]),
        };
    });

    function setup(overrides: TestAppOverrides = {}) {
        return createRunTestApp({
            agents: [
                ...createRunAgents(),
                defineAgent({
                    name: 'intake',
                    model: textModel(),
                    instructions: 'Intake.',
                    channels: [webhook.on('/issues')],
                }),
            ],
            auth: [
                staticTokens({
                    tokens: [
                        {
                            value: ADMIN_TOKEN,
                            id: 'admin',
                            permissions: ['*'],
                        },
                        {
                            value: READER_TOKEN,
                            id: 'reader',
                            permissions: ['run:read'],
                        },
                    ],
                }),
                authup({ verifier: authupVerifier }),
                oidc({ issuers: [issuer], principal: (result) => openclaw(result.claims) }),
            ],
            ...overrides,
        });
    }

    it('REST dispatch, SSE, completed', async () => {
        const { app, engine } = setup();
        const started = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { payload: { n: 1 } } });
        expect(started.status).toBe(202);
        const { runId } = await started.json() as { runId: string };

        const reader = new SseReader(await call(app, 'GET', `/runs/${runId}/stream`, { token: READER_TOKEN }));
        expect((await reader.next(1))[0]).toMatchObject({ event: 'run.updated' });

        await engine.start();
        await engine.idle();
        const events = await reader.rest();
        expect(reader.done).toBe(true);

        const statuses = events
            .filter((e) => e.event === 'run.updated')
            .map((e) => (JSON.parse(e.data) as Run).status);
        expect(statuses).toContain('running');
        expect(statuses.at(-1)).toBe('completed');
        expect(events.some((e) => e.event === 'step.appended')).toBe(true);

        const read = await call(app, 'GET', `/runs/${runId}`, { token: READER_TOKEN });
        const run = await read.json() as Run & { steps: Step[] };
        expect(run.status).toBe('completed');
        expect(run.output).toBeDefined();
        await engine.drain();
    });

    it('approval, POST /runs/:id/approve by an authup principal, completed', async () => {
        const {
            app,
            engine,
            approvalIdOf,
        } = setup();
        const started = await call(app, 'POST', '/agents/gate/runs', { token: ADMIN_TOKEN });
        const { runId } = await started.json() as { runId: string };
        await engine.start();
        await engine.idle();
        expect((await engine.getRun(runId))?.status).toBe('waiting');

        const resumed = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: 'approver',
            body: { approvalId: await approvalIdOf(runId), approved: true },
        });
        expect(resumed.status).toBe(202);
        await engine.idle();

        const read = await call(app, 'GET', `/runs/${runId}`, { token: READER_TOKEN });
        const run = await read.json() as Run & { steps: Step[] };
        expect(run.status).toBe('completed');
        expect(run.steps.some((step) => step.kind === 'wait')).toBe(true);
        await engine.drain();
    });

    it('webhook retries with one Idempotency-Key create one run', async () => {
        const {
            app,
            engine,
            stores: store,
        } = setup();
        const deliver = () => call(app, 'POST', '/channels/webhook/intake/issues', {
            token: ADMIN_TOKEN,
            body: { id: 7 },
            headers: { 'idempotency-key': 'delivery-1' },
        });

        const parallel = await Promise.all([deliver(), deliver()]);
        expect(parallel.map((r) => r.status)).toEqual([202, 202]);
        await engine.start();
        await engine.idle();

        const last = await deliver();
        expect(await last.json()).toMatchObject({ deduplicated: true });
        const { data, total } = await store.runs.listRuns({ agent: 'intake' });
        expect(total).toBe(1);
        expect(data[0]?.status).toBe('completed');
        await engine.drain();
    });

    it('an mcp client with least privilege starts and reads a run', async () => {
        const { app, engine } = setup();
        await engine.start();
        const token = await signToken(signingKey.privateKey, {
            iss: ISSUER,
            aud: 'chamvi',
            sub: 'openclaw',
        });

        const client = await connectMcp(app, token);
        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toContain('run_echo');
        expect(names).not.toContain('run_gate');

        const result = await callTool(client, 'run_echo', { waitSeconds: 5 });
        const { runId, status } = result.structuredContent as { runId: string; status: string };
        expect(status).toBe('completed');
        expect((await callTool(client, 'get_run', { runId })).structuredContent).toMatchObject({ status: 'completed' });
        await client.close();

        expect((await call(app, 'GET', `/runs/${runId}`, { token })).status).toBe(200);
        expect((await call(app, 'GET', '/agents', { token })).status).toBe(403);
        await engine.drain();
    });

    it('shutdown fails readiness, ends streams and drains', async () => {
        const base = setup();
        const closed: boolean[] = [];
        const shutdown = createShutdown({
            engine: base.engine,
            server: { close: async () => { closed.push(true); } },
            readinessDelayMs: 1_000,
        });
        const {
            app,
            engine,
            clock,
        } = setup({
            shutdown,
            engine: base.engine,
        });

        const started = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN });
        const { runId } = await started.json() as { runId: string };
        const reader = new SseReader(await call(app, 'GET', `/runs/${runId}/stream`, { token: READER_TOKEN }));
        await reader.next(1);

        const done = shutdown.shutdown();
        const ready = await call(app, 'GET', '/readyz');
        expect(ready.status).toBe(503);
        expect(await ready.json()).toEqual({ status: 'unavailable', reason: 'shutting-down' });

        clock.advance(1_000);
        await done;
        await reader.rest();
        expect(reader.done).toBe(true);
        expect(closed).toEqual([true]);
        expect(engine.isDraining).toBe(true);
    });
});
