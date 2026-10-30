/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { NotFoundError } from '@ebec/http';
import { App, defineCoreHandler } from 'routup';
import { registerAgentRoutes } from '../agents/module.ts';
import { registerChannelRoutes } from '../channels/module.ts';
import { registerHealthRoutes } from '../health/module.ts';
import { registerMcpRoutes } from '../mcp/module.ts';
import { registerMeRoutes } from '../me/module.ts';
import { installPlugins } from '../plugins/module.ts';
import { assertNoNul } from '../request/helpers.ts';
import { registerRoutes } from '../routes/module.ts';
import { registerRunRoutes } from '../runs/module.ts';
import { buildContext, createErrorHandler } from './helpers.ts';
import type { HttpAppOptions } from './types.ts';

/**
 * Builds the routup App of a chamvi app: health, REST, the listed channels
 * (`/channels/<name>`) and MCP, one JSON error body for every route under `basePath`.
 */
export function createHttpApp(options: HttpAppOptions): App {
    const ctx = buildContext(options);
    const app = new App({
        path: ctx.basePath || undefined,
        ...(options.trustProxy !== undefined ? { options: { trustProxy: options.trustProxy } } : {}),
    });

    installPlugins(app, { ...options, basePath: ctx.basePath });
    app.use(defineCoreHandler((event) => {
        assertNoNul(event);

        return event.next();
    }));
    registerHealthRoutes(app, ctx);
    registerMeRoutes(app, ctx);
    registerAgentRoutes(app, ctx);
    registerRunRoutes(app, ctx);
    registerChannelRoutes(app, ctx);
    registerRoutes(app, ctx);

    if (options.mcp !== false) {
        registerMcpRoutes(app, ctx, options.mcp);
    }

    app.use(defineCoreHandler(() => {
        throw new NotFoundError({ message: 'The requested route does not exist.' });
    }));
    app.use(createErrorHandler(ctx));

    options.shutdown?.onShutdown(async () => {
        ctx.closed = true;
        await Promise.all([...ctx.closers].map(async (close) => {
            try {
                await close();
            } catch (error) {
                ctx.onError(error);
            }
        }));
    });

    return app;
}
