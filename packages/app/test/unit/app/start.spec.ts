/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { cron } from '@chamvi/channel-cron';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryRepositories,
    defineAgent,
} from '@chamvi/core';
import { http } from '@chamvi/http';
import { ControllableClock } from '@chamvi/test-kit';
import type { IModule } from 'orkos';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    APP_ERROR_CODE,
    AppToken,
    ModuleName,
    configModule,
    createApp,
    repositoryModule,
    schedulerModule,
} from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import {
    TOKENS,
    recording,
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

function track(app: IApp): IApp {
    apps.push(app);
    return app;
}

async function envFor(extra: Record<string, string> = {}) {
    const port = await freePort();
    return {
        port,
        env: {
            HOST: '127.0.0.1',
            PORT: String(port),
            CHAMVI_TOKENS: TOKENS,
            ...extra,
        },
    };
}

/** Replaces the http module: serves nothing, registers the http channel by name only (the agents subscribe to it). */
function httpless(): IModule {
    return {
        name: ModuleName.HTTP,
        setup: async (container) => {
            container.registerMany(AppToken.CHANNELS, { useValue: { name: 'http' } });
        },
    };
}

function quiet() {
    const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
    return configModule({ clock, logger: createRecordingLogger(clock) });
}

async function isFree(port: number): Promise<boolean> {
    try {
        await closeServer(await listenOn(port));
        return true;
    } catch {
        return false;
    }
}

describe('App.start', () => {
    it('starts and serves /readyz', async () => {
        const app = track(createApp({ agents: [agent], modules: [quiet()] }));
        const { env, port } = await envFor();

        await app.start({ env });

        expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(200);
        await app.stop();
        expect(await isFree(port)).toBe(true);
    });

    it('start runs an app with no agents and no agents dir', async () => {
        const app = track(createApp({ modules: [quiet()] }));
        const { env } = await envFor();

        await app.start({ env });
    });

    it('a second start rejects app_in_use', async () => {
        const app = track(createApp({ agents: [agent], modules: [quiet()] }));
        const { env } = await envFor();
        await app.start({ env });

        expect(await rejectionOf(app.start({ env }))).toMatchObject({ code: APP_ERROR_CODE.IN_USE });
        expect(await rejectionOf(app.runJob({ env, agent: 'triage' }))).toMatchObject({ code: APP_ERROR_CODE.IN_USE });
        expect(await rejectionOf(app.migrate({ env }))).toMatchObject({ code: APP_ERROR_CODE.IN_USE });
    });

    it('a lifecycle after stop rejects app_in_use', async () => {
        const app = track(createApp({ agents: [agent], modules: [quiet()] }));
        await app.stop();

        expect(await rejectionOf(app.start({ env: {} }))).toMatchObject({ code: APP_ERROR_CODE.IN_USE });
    });

    it('a setup failure tears the ready modules down in reverse order', async () => {
        const events: string[] = [];
        const failure = new Error('engine setup failed');
        const app = track(createApp({
            agents: [agent],
            modules: [
                recording(quiet(), events, 'config'),
                recording(repositoryModule(), events, 'store'),
                {
                    name: ModuleName.ENGINE,
                    dependencies: [ModuleName.CONFIG, ModuleName.STORE],
                    async setup() {
                        throw failure;
                    },
                    async teardown() {
                        events.push('engine teardown');
                    },
                },
            ],
        }));
        const { env } = await envFor();

        expect(await rejectionOf(app.start({ env }))).toBe(failure);
        expect(events.filter((e) => e.endsWith('teardown'))).toEqual(['store teardown', 'config teardown']);
        await app.stop();
        expect(events.filter((e) => e.endsWith('teardown'))).toHaveLength(2);
    });

    it('an onReady failure tears every module down', async () => {
        const events: string[] = [];
        const failure = new Error('onReady failed');
        const app = track(createApp({
            agents: [agent],
            modules: [
                recording(repositoryModule(), events, 'store'),
                quiet(),
                {
                    name: 'late',
                    dependencies: [ModuleName.HTTP],
                    setup: async () => undefined,
                    async onReady() {
                        throw failure;
                    },
                    async teardown() {
                        events.push('late teardown');
                    },
                },
            ],
        }));
        const { env, port } = await envFor();

        expect(await rejectionOf(app.start({ env }))).toBe(failure);
        expect(events.filter((e) => e.endsWith('teardown'))).toEqual(['late teardown', 'store teardown']);
        expect(await isFree(port)).toBe(true);
    });

    const graphModule = (name: string, dependency: string): IModule => ({
        name,
        dependencies: [dependency],
        setup: async () => undefined,
    });

    it.each([
        ['an unregistered dependency', [graphModule('mine', 'chamvi:github')], 'chamvi:github'],
        ['a dependency cycle', [graphModule('a', 'b'), graphModule('b', 'a')], 'ircular'],
    ])('a module graph error (%s) is an InvalidAgentDefinitionError', async (_label, modules, needle) => {
        const app = track(createApp({ agents: [agent], modules: [quiet(), ...modules] }));
        const { env } = await envFor();

        const error = await rejectionOf(app.start({ env }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain(needle);
    });

    describe('a configuration error found in onReady starts nothing', () => {
        async function queuedRun() {
            let calls = 0;
            const counting = textModel();
            const doStream = counting.doStream.bind(counting);
            counting.doStream = async (options) => {
                calls++;
                return doStream(options);
            };
            const queued = defineAgent({
                name: 'queued',
                model: counting,
                instructions: 'x',
                channels: [http.on(), cron.on('*/5 * * * *')],
            });
            const store = createMemoryRepositories();
            // another replica's run, waiting in the shared store
            const other = new Engine({
                repositories: store,
                agents: [queued],
                // names only: this replica serves nothing
                channels: [{ name: 'http' }, { name: 'cron' }],
            });
            const { runId } = await other.dispatch({
                agent: 'queued',
                trigger: 'http',
                channel: 'http',
                payload: {},
            });
            return {
                repositories: store,
                queued,
                runId,
                calls: () => calls,
            };
        }

        it('no authenticator', async () => {
            const ctx = await queuedRun();
            const app = track(createApp({ agents: [ctx.queued], modules: [quiet(), repositoryModule({ repositories: ctx.repositories })] }));
            const { env } = await envFor({ CHAMVI_TOKENS: '' });

            const error = await rejectionOf(app.start({ env }));

            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(error.message).toContain('No authenticator');
            expect(ctx.calls()).toBe(0);
            expect((await ctx.repositories.runs.findOne(ctx.runId))?.status).toBe('queued');
        });

        it('an app without the http module still starts the engine', async () => {
            const ctx = await queuedRun();
            const app = track(createApp({
                agents: [ctx.queued],
                modules: [quiet(), repositoryModule({ repositories: ctx.repositories }), httpless()],
            }));
            const { env } = await envFor({ CHAMVI_TOKENS: '' });

            await app.start({ env });

            await vi.waitFor(async () => {
                expect((await ctx.repositories.runs.findOne(ctx.runId))?.status).toBe('completed');
            });
        });

        it('an app without the http module runs the started hooks', async () => {
            const ctx = await queuedRun();
            const started: string[] = [];
            const app = track(createApp({
                agents: [ctx.queued],
                modules: [
                    quiet(),
                    repositoryModule({ repositories: ctx.repositories }),
                    httpless(),
                    {
                        name: 'hooks',
                        setup: async (container) => {
                            container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                                useValue: {
                                    name: 'probe',
                                    started: () => { started.push('started'); },
                                    stopping: () => { started.push('stopping'); },
                                },
                            });
                        },
                    },
                ],
            }));
            const { env } = await envFor({ CHAMVI_TOKENS: '' });

            await app.start({ env });
            expect(started).toEqual(['started']);

            await app.stop();
            expect(started).toEqual(['started', 'stopping']);
        });

        it('a user module whose onReady fails after the http module', async () => {
            const ctx = await queuedRun();
            const started: string[] = [];
            const app = track(createApp({
                agents: [ctx.queued],
                modules: [quiet(), repositoryModule({ repositories: ctx.repositories }), {
                    name: 'late',
                    // ordered after the http module, so its onReady runs last
                    dependencies: [ModuleName.HTTP],
                    setup: async (container) => {
                        container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: { name: 'probe', started: () => { started.push('started'); } } });
                    },
                    onReady: async () => {
                        throw new InvalidAgentDefinitionError('late module misconfigured');
                    },
                }],
            }));
            const { env } = await envFor();

            expect(await rejectionOf(app.start({ env }))).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(started).toEqual([]);
            expect(ctx.calls()).toBe(0);
            expect((await ctx.repositories.runs.findOne(ctx.runId))?.status).toBe('queued');
        });

        it('a scheduler definition error', async () => {
            const ctx = await queuedRun();
            const app = track(createApp({
                agents: [ctx.queued],
                modules: [quiet(), repositoryModule({ repositories: ctx.repositories }), schedulerModule({ lockTtlMs: 0 })],
            }));
            const { env } = await envFor();

            expect(await rejectionOf(app.start({ env }))).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(ctx.calls()).toBe(0);
            expect((await ctx.repositories.runs.findOne(ctx.runId))?.status).toBe('queued');
        });
    });
});
