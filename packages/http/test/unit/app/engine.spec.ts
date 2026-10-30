/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    createHttpApp,
    http,
    httpChannel,
    webhook,
    webhookChannel,
} from '@chamvi/http';
import { textModel } from '../../utils/model.ts';
import {
    ADMIN_TOKEN,
    call,
    testAuth,
} from '../../utils/app.ts';
import { SseReader } from '../../utils/sse.ts';

function setup() {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStore({ clock });
    const agents = [
        defineAgent({
            name: 'echo',
            model: textModel(),
            instructions: 'Echo.',
            channels: [http.on()],
        }),
        defineAgent({
            name: 'other',
            model: textModel(),
            instructions: 'Other.',
            channels: [http.on()],
        }),
    ];
    const hooks = webhookChannel({ auth: testAuth });
    const options = {
        store,
        agents,
        clock,
        channels: [httpChannel(), hooks],
        onError: () => {},
    };
    const engine = new Engine(options);
    // only the engine knows the store, the agents and the clock
    const app = createHttpApp({
        engine,
        auth: testAuth,
        metrics: false,
        rateLimit: false,
        channels: [hooks],
    });

    return {
        app,
        engine,
        store,
        clock,
        options,
    };
}

describe('createHttpApp over the engine', () => {
    it('serves the engine\'s agents', async () => {
        const { app } = setup();
        const response = await call(app, 'GET', '/agents', { token: ADMIN_TOKEN });

        expect(response.status).toBe(200);

        const { data } = await response.json() as { data: { name: string }[] };

        expect(data.map((agent) => agent.name)).toEqual(['echo', 'other']);
        expect((await call(app, 'POST', '/agents/other/runs', { token: ADMIN_TOKEN })).status).toBe(202);
    });

    it('reads runs from the engine\'s store', async () => {
        const { app, engine } = setup();
        const { runId } = await engine.dispatch({
            agent: 'echo',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        const response = await call(app, 'GET', `/runs/${runId}`, { token: ADMIN_TOKEN });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: runId, status: 'queued' });
    });

    it('polls the stream on the engine\'s clock', async () => {
        const {
            app,
            clock,
            options,
        } = setup();
        const started = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN });
        const { runId } = await started.json() as { runId: string };
        const reader = new SseReader(await call(app, 'GET', `/runs/${runId}/stream`, { token: ADMIN_TOKEN }));

        await reader.next(1);

        // another replica runs it: only the store poll sees the change
        const other = new Engine({ ...options, owner: 'replica-b' });

        await other.start();
        await other.idle();
        clock.advance(2_000);

        const events = await reader.rest();
        const statuses = events
            .filter((event) => event.event === 'run.updated')
            .map((event) => (JSON.parse(event.data) as { status: string }).status);

        expect(statuses).toContain('completed');
        await other.drain();
    });

    it('serves only the named agents', async () => {
        const { engine } = setup();
        const app = createHttpApp({
            engine,
            agents: ['echo'],
            auth: testAuth,
            metrics: false,
            rateLimit: false,
        });
        const response = await call(app, 'GET', '/agents', { token: ADMIN_TOKEN });
        const { data } = await response.json() as { data: { name: string }[] };

        expect(data.map((agent) => agent.name)).toEqual(['echo']);
        expect((await call(app, 'POST', '/agents/other/runs', { token: ADMIN_TOKEN })).status).toBe(404);
        expect((await call(app, 'GET', '/agents/other/state/kv/k', { token: ADMIN_TOKEN })).status).toBe(404);
        expect((await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN })).status).toBe(202);
    });

    it('rejects an agent name the engine lacks or a name given twice', () => {
        const { engine } = setup();
        const make = (agents: string[]) => createHttpApp({
            engine,
            agents,
            auth: testAuth,
            metrics: false,
            rateLimit: false,
        });

        expect(() => make(['missing'])).toThrow(InvalidAgentDefinitionError);
        expect(() => make(['echo', 'echo'])).toThrow(InvalidAgentDefinitionError);
    });

    it('serves an agent registered after the app was built', async () => {
        const { app, engine } = setup();

        await engine.putAgent(defineAgent({
            name: 'late',
            model: textModel(),
            instructions: 'Late.',
            channels: [http.on()],
        }));

        const { data } = await (await call(app, 'GET', '/agents', { token: ADMIN_TOKEN })).json() as { data: { name: string }[] };

        expect(data.map((agent) => agent.name)).toEqual(['echo', 'other', 'late']);
        expect((await call(app, 'POST', '/agents/late/runs', { token: ADMIN_TOKEN })).status).toBe(202);
        expect((await call(app, 'PATCH', '/agents/late/state/kv/k', { token: ADMIN_TOKEN, body: { value: 1 } })).status).toBe(200);
        expect(await (await call(app, 'GET', '/agents/late/state/kv/k', { token: ADMIN_TOKEN })).json()).toEqual({ key: 'k', value: 1 });
    });

    it('answers 404 after the agent was removed', async () => {
        const { app, engine } = setup();

        await engine.putAgent(defineAgent({
            name: 'hooked',
            model: textModel(),
            instructions: 'Hooked.',
            channels: [webhook.on('/x')],
        }));
        expect((await call(app, 'POST', '/channels/webhook/hooked/x', { token: ADMIN_TOKEN, body: {} })).status).toBe(202);

        await engine.removeAgent('other');
        await engine.removeAgent('hooked');
        expect((await call(app, 'POST', '/agents/other/runs', { token: ADMIN_TOKEN })).status).toBe(404);
        expect((await call(app, 'POST', '/channels/webhook/hooked/x', { token: ADMIN_TOKEN, body: {} })).status).toBe(404);
        expect((await call(app, 'GET', '/agents/other/state/kv/k', { token: ADMIN_TOKEN })).status).toBe(404);

        const { data } = await (await call(app, 'GET', '/agents', { token: ADMIN_TOKEN })).json() as { data: { name: string }[] };

        expect(data.map((agent) => agent.name)).toEqual(['echo']);
    });

    it('GET /runs/:id of a removed agent\'s run still answers', async () => {
        const { app, engine } = setup();
        const started = await call(app, 'POST', '/agents/other/runs', { token: ADMIN_TOKEN });
        const { runId } = await started.json() as { runId: string };

        await engine.removeAgent('other');

        const response = await call(app, 'GET', `/runs/${runId}`, { token: ADMIN_TOKEN });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            id: runId,
            agent: 'other',
            status: 'cancelled',
        });
    });

    it('keeps an agent registered later out of an app serving named agents', async () => {
        const { engine } = setup();
        const app = createHttpApp({
            engine,
            agents: ['echo', 'other'],
            auth: testAuth,
            metrics: false,
            rateLimit: false,
        });

        await engine.putAgent(defineAgent({
            name: 'late',
            model: textModel(),
            instructions: 'Late.',
            channels: [http.on()],
        }));
        await engine.removeAgent('other');

        const { data } = await (await call(app, 'GET', '/agents', { token: ADMIN_TOKEN })).json() as { data: { name: string }[] };

        expect(data.map((agent) => agent.name)).toEqual(['echo']);
        expect((await call(app, 'POST', '/agents/late/runs', { token: ADMIN_TOKEN })).status).toBe(404);
        expect((await call(app, 'POST', '/agents/other/runs', { token: ADMIN_TOKEN })).status).toBe(404);
    });
});
