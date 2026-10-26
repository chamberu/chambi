/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryStore, defineAgent } from '@chamvi/core';
import { http } from '@chamvi/http';
import type { Engine } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    APP_ERROR_CODE,
    AppToken,
    ModuleName,
    configModule,
    createApp,
    storeModule,
} from '@chamvi/app';
import type { IApp, ILifecycleHook } from '@chamvi/app';
import {
    TOKENS,
    deferred,
    rejectionOf,
} from '../../utils/app.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { textModel } from '../../utils/model.ts';
import { closeServer, freePort, listenOn } from '../../utils/port.ts';

const agent = defineAgent({
    name: 'triage',
    model: textModel(),
    instructions: 'x',
    channels: [http.on()],
});

let apps: IApp[] = [];

afterEach(async () => {
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    apps = [];
});

async function envFor() {
    const port = await freePort();
    return {
        port,
        url: (path: string) => `http://127.0.0.1:${port}${path}`,
        env: {
            HOST: '127.0.0.1',
            PORT: String(port),
            CHAMVI_TOKENS: TOKENS,
        },
    };
}

function quiet() {
    const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
    const logger = createRecordingLogger(clock);
    return { logger, module: configModule({ clock, logger }) };
}

function build(modules: IModule[]) {
    const { logger, module } = quiet();
    const app = createApp({ agents: [agent], modules: [module, ...modules] });
    apps.push(app);
    return { app, logger };
}

function hookModule(hook: ILifecycleHook): IModule {
    return {
        name: `hooks:${hook.name}`,
        async setup(container: IContainer) {
            container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: hook });
        },
    };
}

async function isFree(port: number): Promise<boolean> {
    try {
        await closeServer(await listenOn(port));
        return true;
    } catch {
        return false;
    }
}

describe('App.stop', () => {
    it('never listens when stop arrives during setup', async () => {
        const gate = deferred();
        const entered = deferred();
        const real = storeModule();
        const { app, logger } = build([{
            name: ModuleName.STORE,
            dependencies: [ModuleName.CONFIG],
            async setup(container) {
                entered.resolve();
                await gate.promise;
                await real.setup(container);
            },
        }]);
        const { env, port } = await envFor();

        const started = rejectionOf(app.start({ env }));
        await entered.promise;
        const stopped = app.stop();
        gate.resolve();

        expect(await started).toMatchObject({ code: APP_ERROR_CODE.STOPPED });
        await stopped;
        expect(logger.entries.find((e) => e.msg === 'listening')).toBeUndefined();
        expect(await isFree(port)).toBe(true);
    });

    it('logs a setup failure that a stop during setup answers with app_stopped', async () => {
        const gate = deferred();
        const entered = deferred();
        const { app, logger } = build([{
            name: ModuleName.STORE,
            dependencies: [ModuleName.CONFIG],
            async setup() {
                entered.resolve();
                await gate.promise;
                throw new Error('migration 1792540800000 failed');
            },
        }]);
        const { env } = await envFor();

        const started = rejectionOf(app.start({ env }));
        await entered.promise;
        const stopped = app.stop();
        gate.resolve();

        expect(await started).toMatchObject({ code: APP_ERROR_CODE.STOPPED });
        await stopped;
        const entry = logger.entries.find((e) => e.level === 'error');
        expect(JSON.stringify(entry)).toContain('migration 1792540800000 failed');
    });

    it('is memoized', async () => {
        const teardowns: string[] = [];
        const { app } = build([{
            name: 'counted',
            setup: async () => undefined,
            async teardown() {
                teardowns.push('counted');
            },
        }]);
        const { env } = await envFor();
        await app.start({ env });

        const first = app.stop();
        const second = app.stop();

        expect(second).toBe(first);
        await first;
        expect(teardowns).toEqual(['counted']);
    });

    it('resolves before any lifecycle', async () => {
        const { app } = build([]);
        await expect(app.stop()).resolves.toBeUndefined();
    });

    it('reports teardown errors and rejects with app_stop_failed', async () => {
        const events: string[] = [];
        const failure = new Error('teardown failed');
        const { app, logger } = build([
            {
                name: 'after',
                setup: async () => undefined,
                async teardown() {
                    events.push('after teardown');
                },
            },
            {
                name: 'failing',
                setup: async () => undefined,
                async teardown() {
                    throw failure;
                },
            },
        ]);
        const { env } = await envFor();
        await app.start({ env });

        const error = await rejectionOf(app.stop());

        expect(error).toMatchObject({ code: APP_ERROR_CODE.STOP_FAILED, message: '1 error(s) while stopping; see the log.' });
        expect(error.cause).toBeInstanceOf(AggregateError);
        expect((error.cause as AggregateError).errors).toEqual([failure]);
        expect(events).toEqual(['after teardown']);
        expect(logger.lines.some((line) => line.includes('teardown failed'))).toBe(true);
    });

    it('follows the shutdown order', async () => {
        const events: string[] = [];
        const once = (event: string) => {
            if (!events.includes(event)) events.push(event);
        };
        const { env, url } = await envFor();

        // the cron channel's stand-in: the drain stops channels first
        const scheduler: IModule = {
            name: ModuleName.SCHEDULER,
            async setup(container) {
                container.registerMany(AppToken.CHANNELS, {
                    useValue: {
                        name: 'cron',
                        start: async () => {},
                        stop: async () => once('channel stop'),
                    },
                });
            },
        };
        const store: IModule = {
            name: ModuleName.STORE,
            dependencies: [ModuleName.CONFIG],
            async setup(container) {
                container.register(AppToken.STORE, { useValue: new MemoryStore() });
                container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                    useValue: {
                        name: 'purge',
                        stopping: async () => {
                            if (events.length === 0) {
                                const response = await fetch(url('/readyz'));
                                if (response.status === 503) events.push('readyz 503');
                            }
                            once('purge stop hook');
                        },
                    },
                });
            },
            async teardown() {
                events.push('data source destroy');
            },
        };
        const recorder = hookModule({
            name: 'recorder',
            engineCreated: (engine: Engine) => {
                const drain = engine.drain.bind(engine);
                engine.drain = async (input) => {
                    if (!events.includes('engine drained')) {
                        // server.close() runs before the drain: the port stops accepting at once
                        const refused = await fetch(url('/healthz')).then(() => false, () => true);
                        if (refused) once('server closed');
                    }
                    await drain(input);
                    once('engine drained');
                };
            },
            drained: () => once('drained hook'),
        });
        const { app } = build([store, scheduler, recorder]);
        await app.start({ env });

        await app.stop();

        expect(events).toEqual([
            'readyz 503',
            'purge stop hook',
            'server closed',
            'channel stop',
            'engine drained',
            'drained hook',
            'data source destroy',
        ]);
    });
});
