/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { defineAgent } from '@chamvi/core';
import { webhook } from '@chamvi/http';
import type { Principal } from '@chamvi/http';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunAgents,
    createRunTestApp,
    permissionsAuth,
    testAuth,
} from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';
import { readEvents } from '../../utils/sse.ts';

const ALICE_TOKEN = 'alice';

/** `Bearer alice`: an authup-like principal with claims. */
async function aliceAuth(request: Request): Promise<Principal | undefined> {
    if (request.headers.get('authorization') !== `Bearer ${ALICE_TOKEN}`) return undefined;
    return {
        id: 'user-1',
        kind: 'authup',
        permissions: ['agent:gate:run', 'agent:gate:approve', 'tool:gate:deploy'],
        claims: { preferred_username: 'alice', email: 'alice@example.com' },
    };
}

function setup() {
    return createRunTestApp({ auth: [testAuth, permissionsAuth, aliceAuth] });
}

async function startRun(app: ReturnType<typeof setup>['app'], token: string, agent = 'gate'): Promise<string> {
    const response = await call(app, 'POST', `/agents/${agent}/runs`, { token });
    expect(response.status).toBe(202);
    return (await response.json() as { runId: string }).runId;
}

describe('run invoker over REST', () => {
    it('records the authenticated principal as the invoker', async () => {
        const { app, repositories: store } = setup();
        const runId = await startRun(app, ALICE_TOKEN);
        expect((await store.runs.findOne(runId))?.trigger.invoker).toEqual({
            id: 'user-1',
            kind: 'authup',
            name: 'alice',
            permissions: ['agent:gate:run', 'agent:gate:approve', 'tool:gate:deploy'],
        });
    });

    it('records a static token as kind token without a name', async () => {
        const { app, repositories: store } = setup();
        const runId = await startRun(app, ADMIN_TOKEN, 'echo');
        expect((await store.runs.findOne(runId))?.trigger.invoker).toEqual({
            id: 'admin',
            kind: 'token',
            permissions: ['*'],
        });
    });

    it('never takes an email claim as the name, so readers never see it', async () => {
        const bobAuth = async (request: Request): Promise<Principal | undefined> => {
            if (request.headers.get('authorization') !== 'Bearer bob') return undefined;
            return {
                id: 'user-2',
                kind: 'oidc',
                permissions: ['agent:gate:run'],
                claims: { email: 'bob@example.com' },
            };
        };
        const { app, repositories: store } = createRunTestApp({ auth: [testAuth, bobAuth] });
        const runId = await startRun(app, 'bob');
        expect((await store.runs.findOne(runId))?.trigger.invoker).not.toHaveProperty('name');
        const response = await call(app, 'GET', `/runs/${runId}`, { token: READER_TOKEN });
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain('bob@example.com');
    });

    it('never takes the invoker from the body', async () => {
        const { app, repositories: store } = setup();
        const response = await call(app, 'POST', '/agents/echo/runs', {
            token: ADMIN_TOKEN,
            body: {
                invoker: {
                    id: 'forged', 
                    kind: 'user', 
                    permissions: ['*'], 
                }, 
            },
        });
        const { runId } = await response.json() as { runId: string };
        expect((await store.runs.findOne(runId))?.trigger.invoker?.id).toBe('admin');
    });

    it('dispatches webhook runs without an invoker', async () => {
        const agents = [
            ...createRunAgents(),
            defineAgent({
                name: 'intake',
                model: textModel(),
                instructions: 'Intake.',
                channels: [webhook.on('/in')],
            }),
        ];
        const { app, repositories: store } = createRunTestApp({ agents });
        const response = await call(app, 'POST', '/channels/webhook/intake/in', { token: ADMIN_TOKEN, body: {} });
        expect(response.status).toBe(202);
        const { runId } = await response.json() as { runId: string };
        expect((await store.runs.findOne(runId))?.trigger).not.toHaveProperty('invoker');
    });

    it('drops the invoker permissions from GET /runs and GET /runs/:id', async () => {
        const { app } = setup();
        const runId = await startRun(app, ALICE_TOKEN);

        const one = await (await call(app, 'GET', `/runs/${runId}`, { token: READER_TOKEN })).json();
        expect(one.trigger.invoker).toEqual({
            id: 'user-1', 
            kind: 'authup', 
            name: 'alice', 
        });

        const list = await (await call(app, 'GET', '/runs', { token: READER_TOKEN })).json();
        expect(list.data[0].trigger.invoker).toEqual({
            id: 'user-1', 
            kind: 'authup', 
            name: 'alice', 
        });
    });

    it('records the approver on the wait step and drops its permissions from responses', async () => {
        const {
            app,
            engine,
            repositories: store,
            approvalIdOf,
        } = setup();
        const runId = await startRun(app, ALICE_TOKEN);
        await engine.start();
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');

        const response = await call(app, 'POST', `/runs/${runId}/approve`, {
            token: ALICE_TOKEN,
            body: { approvalId: await approvalIdOf(runId), approved: true },
        });
        expect(response.status).toBe(202);
        await engine.idle();

        const wait = (await store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect((wait?.output as { approver?: unknown }).approver).toEqual({
            id: 'user-1',
            kind: 'authup',
            name: 'alice',
            permissions: ['agent:gate:run', 'agent:gate:approve', 'tool:gate:deploy'],
        });

        const view = await (await call(app, 'GET', `/runs/${runId}`, { token: READER_TOKEN })).json();
        const waitView = view.steps.find((s: { kind: string }) => s.kind === 'wait');
        expect(waitView.output.approver).toEqual({
            id: 'user-1', 
            kind: 'authup', 
            name: 'alice', 
        });
        expect(waitView.output.approved).toBe(true);

        const events = await readEvents(await call(app, 'GET', `/runs/${runId}/stream`, { token: READER_TOKEN }));
        expect(events.length).toBeGreaterThan(0);
        for (const event of events) {
            expect(event.data).not.toContain('tool:gate:deploy');
        }
        const runEvent = JSON.parse(events[0]!.data);
        expect(runEvent.trigger.invoker).toEqual({
            id: 'user-1', 
            kind: 'authup', 
            name: 'alice', 
        });
        await engine.drain();
    });
});
