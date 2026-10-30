/* eslint @tada5hi/type-declaration-location: "off" -- Keep the exported contract in the self-contained instructional snippet. */
import {
    AppToken,
    ModuleName,
    defineContextKey,
    inject,
} from '@chamvi/app';
import type {
    IContainer,
    IModule,
    StateSchema,
    ToolContext,
} from '@chamvi/app';

// #region module
export interface IAuditLog {
    write(line: string): void;
}

// the key stays inside the package; the pair below is its public face
const AUDIT_CONTEXT = defineContextKey<IAuditLog>('audit');

export function injectAuditContext<S extends StateSchema = StateSchema>(ctx: ToolContext<S>): IAuditLog {
    return inject(ctx, AUDIT_CONTEXT);
}

export function auditModule(): IModule {
    let unsubscribe: (() => void) | undefined;

    return {
        name: 'audit',
        // onReady resolves ENGINE, so the engine module sets up first
        dependencies: [ModuleName.ENGINE],

        // setup contributes: every consumer (engine, http) builds in onReady
        async setup(container: IContainer) {
            container.registerMany(AppToken.HTTP_ROUTES, {
                useValue: {
                    method: 'GET',
                    path: '/audit',
                    // extra routes check their own credentials
                    handler: async () => ({ status: 200, body: { ok: true } }),
                },
            });

            const logger = container.resolve(AppToken.LOGGER);
            const log: IAuditLog = { write: (line) => logger.info(line) };

            container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                useValue: {
                    name: 'audit',
                    // before engine.start(): tools reach the log through injectAuditContext(ctx)
                    engineCreated: (engine) => engine.provide(AUDIT_CONTEXT, log),
                    started: () => logger.info('audit ready'),
                    drained: () => logger.info('audit: every run drained'),
                },
            });
        },

        // onReady consumes: the engine exists but has not started, the server is not listening yet
        async onReady(container: IContainer) {
            // migrate builds config and store only: no ENGINE to resolve
            if (container.resolve(AppToken.CONTEXT).mode === 'migrate') {
                return;
            }

            const logger = container.resolve(AppToken.LOGGER);

            unsubscribe = container.resolve(AppToken.ENGINE).on('run.updated', ({ run }) => {
                logger.info('run updated', { run: run.id, status: run.status });
            });
        },

        // also called after an onReady that threw half-way
        async teardown() {
            unsubscribe?.();
        },
    };
}
// #endregion module
