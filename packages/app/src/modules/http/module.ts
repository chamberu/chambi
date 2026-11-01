/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    assertMcpRunTool,
    createHttpApp,
    createShutdown,
    httpChannel,
    mcpChannel,
    webhookChannel,
} from '@chamvi/http';
import type { IShutdown } from '@chamvi/http';
import type { IContainer } from 'eldin';
import type { IModule, ModuleDependency } from 'orkos';
import { serve } from 'routup';
import { AppToken, ModuleName } from '../../module/constants.ts';
import { runHooks, throwIfStopped } from '../../module/helpers.ts';
import { registerStartStep } from '../../module/start.ts';
import type { Server } from '../../module/types.ts';
import { assertUntrustedOptions, createDeferredAuthenticator, resolveAuthenticators } from './helpers.ts';
import type { HttpModuleOptions } from './types.ts';

/**
 * Serves the HTTP app (start mode only). `setup` (start and job) contributes
 * the `http`, `mcp` and `webhook` channels to `CHANNELS` (the webhook channel
 * authenticates with the app's authenticator chain; `untrusted` makes the
 * `http` or `mcp` channel taint its runs) and the folder agents'
 * MCP tool check (`AGENT_CHECKS`, unless `mcp: false`); `onReady` builds the
 * graceful shutdown (`SHUTDOWN`) and the routup app from every
 * `AUTHENTICATORS` and `HTTP_ROUTES` contribution, mounting every
 * contributed channel with an `in` at `/channels/<name>`, then registers the
 * `serve` start step: the app runs the start steps (the engine with its
 * channels, then this one: the `started` hooks, listening, `SERVER`) only
 * once every module's `onReady` ran, so a configuration error any of them
 * finds starts nothing. `teardown` runs the shutdown: readiness 503, the
 * `stopping` hooks, the app's closers, server close, engine drain (which
 * stops the channels first).
 */
export class HttpModule implements IModule {
    readonly name: string = ModuleName.HTTP;

    readonly dependencies: (string | ModuleDependency)[] = [
        ModuleName.ENGINE,
        // its onReady may contribute the dev token
        { name: ModuleName.STATIC_TOKENS, optional: true },
    ];

    protected options: HttpModuleOptions;

    protected shutdown: IShutdown | undefined;

    protected webhookAuth = createDeferredAuthenticator();

    constructor(options: HttpModuleOptions = {}) {
        assertUntrustedOptions(options.untrusted);
        this.options = options;
    }


    async setup(container: IContainer): Promise<void> {
        if (container.resolve(AppToken.CONTEXT).mode === 'migrate') {
            return;
        }

        // in job mode too, so http.on() and webhook.on() subscriptions validate
        const webhook = webhookChannel({
            auth: this.webhookAuth.authenticator,
            ...(this.options.bodyLimit !== undefined && { bodyLimit: this.options.bodyLimit }),
        });

        const untrusted = this.options.untrusted ?? {};
        const channels = [
            httpChannel(untrusted.http ? { untrusted: true } : {}),
            mcpChannel(untrusted.mcp ? { untrusted: true } : {}),
            webhook,
        ];

        for (const channel of channels) {
            container.registerMany(AppToken.CHANNELS, { useValue: channel });
        }

        // a folder agent whose run_<agent> MCP tool cannot be built is a load issue, in every mode, so the modes agree
        if (this.options.mcp !== false) {
            container.registerMany(AppToken.AGENT_CHECKS, { useValue: assertMcpRunTool });
        }
    }

    async onReady(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);

        if (context.mode !== 'start') {
            return;
        }

        const config = container.resolve(AppToken.CONFIG);
        const logger = container.resolve(AppToken.LOGGER);
        const engine = container.resolve(AppToken.ENGINE);
        const auth = resolveAuthenticators(container);

        this.webhookAuth.resolve(auth);

        let server: Server | undefined;
        const shutdown = createShutdown({
            engine,
            server: { close: (force) => (server ? server.close(force) : Promise.resolve()) },
            // a check never served: nothing to take out of rotation
            readinessDelayMs: context.check ? 0 : config.http.readinessDelayMs,
            drainTimeoutMs: config.http.drainTimeoutMs,
            closeTimeoutMs: config.http.closeTimeoutMs,
            onError: (error) => context.report(error, { phase: 'shutdown' }),
        });

        // the first callback, before the http app's own: the stopping hooks (the purge timer); the drain stops the channels.
        // A check never ran `started`, so it never runs `stopping` either
        if (!context.check) {
            shutdown.onShutdown(() => runHooks(container, 'stopping'));
        }

        this.shutdown = shutdown;
        container.register(AppToken.SHUTDOWN, { useValue: shutdown });

        // `untrusted` configures the channels above, not the http app
        const appOptions = { ...this.options };

        delete appOptions.untrusted;

        const app = createHttpApp({
            ...appOptions,
            engine,
            auth,
            shutdown,
            basePath: config.http.basePath,
            routes: container.resolveAll(AppToken.HTTP_ROUTES),
            // every contributed channel the http app can serve; the engine holds the same instances
            channels: container.resolveAll(AppToken.CHANNELS).filter((channel) => typeof channel.in === 'function'),
            ...(container.has(AppToken.AGENT_ISSUES) && { agentIssues: container.resolve(AppToken.AGENT_ISSUES) }),
            onError: (error) => logger.error('http error', error),
        });

        // after the engine's step (registered in its onReady, which runs first)
        registerStartStep(container, ModuleName.HTTP, async () => {
            await runHooks(container, 'started');
            throwIfStopped(context);

            server = serve(app, {
                port: config.http.port,
                hostname: config.http.host,
                silent: true,
                gracefulShutdown: false,
            });
            container.register(AppToken.SERVER, { useValue: server });
            await server.ready();

            logger.info('listening', { url: server.url });
            // a stop that arrived while binding tears down at once
            throwIfStopped(context);
        });
    }

    async teardown(): Promise<void> {
        // idempotent; runs with whatever onReady built (nothing to close before the shutdown existed)
        await this.shutdown?.shutdown();
    }
}

export function httpModule(options?: HttpModuleOptions): IModule {
    return new HttpModule(options);
}
