/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { UnauthorizedError } from '@ebec/http';
import { defineCoreHandler } from 'routup';
import type { App } from 'routup';
import { refuseWhenClosed } from '../app/helpers.ts';
import type { HttpContext, McpOptions } from '../app/types.ts';
import { authenticate } from '../auth/helpers.ts';
import { assertContentLength, readBodyBytes } from '../request/helpers.ts';
import {
    DEFAULT_MCP_MAX_WAIT_SECONDS,
    DEFAULT_MCP_NAME,
    DEFAULT_MCP_VERSION,
} from './constants.ts';
import { readRequestExtra } from './helpers.ts';
import { createRunToolSource, registerTools } from './tools.ts';
import type { McpEndpointOptions, McpRequestExtra } from './types.ts';

function withoutTransferEncoding(input: Headers): Headers {
    const headers = new Headers(input);

    headers.delete('transfer-encoding');

    return headers;
}

/**
 * The MCP handler: one McpServer per request, with the tools the request's
 * principal (from `authInfo.extra`) may use; a `run_<agent>` definition is
 * built once per agent object (see `createRunToolSource`). Bodies are bounded
 * by `bodyLimit`, like REST.
 */
export function createMcpEndpoint(ctx: HttpContext, options: McpEndpointOptions): McpHttpHandler {
    const runTools = createRunToolSource(ctx, options);

    return createMcpHandler(({ authInfo }) => {
        const extra = readRequestExtra(authInfo?.extra);

        // the route always passes them; a request without them cannot reach here
        if (!extra) {
            throw new UnauthorizedError({ message: 'Authentication required.' });
        }

        const server = new McpServer({ name: options.name, version: options.version });

        registerTools(server, ctx, runTools(), extra, options);

        return server;
    }, { maxRequestBodySize: ctx.bodyLimit });
}

/** Mounts the MCP endpoint at `/mcp` (authenticated); the app's shutdown hook ends open waits and closes it. */
export function registerMcpRoutes(app: App, ctx: HttpContext, options: McpOptions = {}): void {
    const handler = createMcpEndpoint(ctx, {
        name: options.name ?? DEFAULT_MCP_NAME,
        version: options.version ?? DEFAULT_MCP_VERSION,
        maxWaitSeconds: options.maxWaitSeconds ?? DEFAULT_MCP_MAX_WAIT_SECONDS,
    });

    // ends run_<agent> waits on shutdown: the legacy stateless path is not torn down by handler.close()
    const closing = new AbortController();

    app.use('/mcp', defineCoreHandler(async (event) => {
        const principal = await authenticate(event, ctx);
        const refused = refuseWhenClosed(event, ctx);

        if (refused) {
            return refused;
        }

        assertContentLength(event, ctx.bodyLimit);

        // read here, bounded and drained like REST bodies; the SDK gets the bytes
        const request = event.request.method === 'POST' ?
            new Request(event.request.url, {
                method: 'POST',
                headers: withoutTransferEncoding(event.request.headers),
                body: await readBodyBytes(event, ctx.bodyLimit, true),
                signal: event.request.signal,
            }) :
            event.request;
        // event.request.signal is the only signal that follows the HTTP request
        const extra: McpRequestExtra = { principal, signal: AbortSignal.any([event.request.signal, closing.signal]) };

        return handler.fetch(request, {
            authInfo: {
                token: '',
                clientId: principal.id,
                scopes: [...principal.permissions],
                extra,
            },
        });
    }));

    ctx.closers.add(async () => {
        // a wait answers with the run as stored, so the client keeps the run id
        closing.abort();
        await handler.close();
    });
}
