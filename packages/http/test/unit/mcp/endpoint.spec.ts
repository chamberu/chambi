/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { 
    describe, 
    expect, 
    it, 
    vi, 
} from 'vitest';
import { App } from 'routup';
import type { IShutdown } from '@chamvi/http';
import { buildContext, createErrorHandler } from '../../../src/app/helpers.ts';
import { registerMcpRoutes } from '../../../src/mcp/module.ts';
import {
    ADMIN_TOKEN,
    call,
    createRunTestApp,
    testAuth,
} from '../../utils/app.ts';
import { callTool, connectMcp } from '../../utils/mcp.ts';

const LIST_TOOLS = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
};
const MCP_HEADERS = { accept: 'application/json, text/event-stream' };

/** An IShutdown whose callbacks the test runs itself. */
function fakeShutdown() {
    const callbacks: Array<() => void | Promise<void>> = [];
    const shutdown: IShutdown = {
        shuttingDown: false,
        onShutdown: (fn) => {
            callbacks.push(fn);
            return () => {};
        },
        shutdown: async () => {
            for (const fn of callbacks) await fn();
        },
    };
    return shutdown;
}

describe('/mcp', () => {
    it('answers 401 JSON with a bearer challenge before the mcp layer', async () => {
        const { app } = createRunTestApp();
        const response = await call(app, 'POST', '/mcp', {
            body: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            },
            headers: { accept: 'application/json, text/event-stream' },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(await response.json()).toMatchObject({ status: 401, code: 'unauthorized' });

        await expect(connectMcp(app, undefined)).rejects.toThrow();
    });

    it('mounts nothing with mcp: false', async () => {
        const { app } = createRunTestApp({ mcp: false });
        const response = await call(app, 'POST', '/mcp', { token: ADMIN_TOKEN, body: {} });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'not_found' });
    });

    it('rejects a body over bodyLimit before any tool runs', async () => {
        const { app, stores: store } = createRunTestApp({ bodyLimit: 1_024 });
        const getRun = vi.spyOn(store.runs, 'getRun');
        const client = await connectMcp(app, ADMIN_TOKEN);
        await expect(callTool(client, 'get_run', { runId: 'x'.repeat(2_048) })).rejects.toThrow(/413|large/i);
        expect(getRun).not.toHaveBeenCalled();
        await client.close();
    });

    it('reports its server info', async () => {
        const { app } = createRunTestApp({ mcp: { name: 'ops', version: '1.2.3' } });
        const client = await connectMcp(app, ADMIN_TOKEN);
        expect(client.getServerVersion()).toMatchObject({ name: 'ops', version: '1.2.3' });
        await client.close();
    });

    it('closes the mcp handler through the app closers', async () => {
        const { engine } = createRunTestApp();
        const onError = vi.fn();
        const ctx = buildContext({
            engine,
            auth: testAuth,
            onError,
        });
        const app = new App();
        registerMcpRoutes(app, ctx);
        app.use(createErrorHandler(ctx));
        expect(ctx.closers.size).toBe(1);

        const open = await call(app, 'POST', '/mcp', {
            token: ADMIN_TOKEN, 
            body: LIST_TOOLS, 
            headers: MCP_HEADERS, 
        });
        expect(open.status).toBe(200);

        for (const close of ctx.closers) await close();
        // ungated on purpose: the closed handler itself refuses the request
        const closed = await call(app, 'POST', '/mcp', {
            token: ADMIN_TOKEN, 
            body: LIST_TOOLS, 
            headers: MCP_HEADERS, 
        });
        expect(closed.status).toBe(500);
        expect(String(onError.mock.calls[0]?.[0])).toMatch(/closed/i);
    });

    it('answers 503 once the app closers ran', async () => {
        const shutdown = fakeShutdown();
        const onError = vi.fn();
        const { app } = createRunTestApp({ shutdown, onError });
        await shutdown.shutdown();
        const response = await call(app, 'POST', '/mcp', {
            token: ADMIN_TOKEN, 
            body: LIST_TOOLS, 
            headers: MCP_HEADERS, 
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ status: 503, code: 'service_unavailable' });
        expect(onError).not.toHaveBeenCalled();
    });

    it('ends a run_<agent> wait in flight on shutdown, answering with the run id', async () => {
        const shutdown = fakeShutdown();
        const { app, engine } = createRunTestApp({ shutdown });
        const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
        const on = engine.on.bind(engine);
        vi.spyOn(engine, 'on').mockImplementation(((event: never, listener: never) => {
            const unsubscribe = vi.fn(on(event, listener));
            unsubscribes.push(unsubscribe);
            return unsubscribe;
        }) as typeof engine.on);

        const client = await connectMcp(app, ADMIN_TOKEN);
        const pending = callTool(client, 'run_echo', { waitSeconds: 30 });
        await vi.waitFor(() => expect(unsubscribes).toHaveLength(1));

        await shutdown.shutdown();
        expect(unsubscribes[0]).toHaveBeenCalled();
        const result = await pending;
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({ runId: expect.any(String), status: 'queued' });
        await client.close();
    });
});
