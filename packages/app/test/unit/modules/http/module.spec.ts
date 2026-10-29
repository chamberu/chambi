/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    InvalidAgentDefinitionError,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { Agent, Engine } from '@chamvi/core';
import { http } from '@chamvi/http';
import { ControllableClock, approvalModel, textModel } from '@chamvi/test-kit';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    APP_ERROR_CODE,
    AppToken,
    ModuleName,
    configModule,
    engineModule,
    httpModule,
    schedulerModule,
    staticTokensModule,
    storeModule,
} from '@chamvi/app';
import type { ILifecycleHook } from '@chamvi/app';
import { createStoppedError } from '../../../../src/module/helpers.ts';
import { buildHarness } from '../../../utils/harness.ts';
import type { Harness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';
import {
    closeServer,
    freePort,
    listenOn,
} from '../../../utils/port.ts';

const TOKEN = 'a-static-token-of-length';
const TOKENS = JSON.stringify([{
    value: TOKEN,
    id: 'ops',
    permissions: ['*'],
}]);

function triage(model: Agent['definition']['model'] = textModel()): Agent {
    return defineAgent({
        name: 'triage',
        model,
        instructions: 'triage',
        channels: [http.on()],
    });
}

function contributing(name: string, register: (container: IContainer) => void): IModule {
    return {
        name,
        async setup(container) {
            register(container);
        },
    };
}

function hooks(hook: ILifecycleHook): IModule {
    return contributing(`hooks:${hook.name}`, (container) => {
        container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: hook });
    });
}

/** Records the engine's drain calls. */
function drainRecorder(events: string[]): IModule {
    return hooks({
        name: 'drain-recorder',
        engineCreated: (engine: Engine) => {
            const drain = engine.drain.bind(engine);
            engine.drain = async (input) => {
                await drain(input);
                events.push('engine drained');
            };
        },
    });
}

let harnesses: Harness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

async function build(options: {
    agents?: Agent[];
    env?: Record<string, string>;
    modules?: IModule[];
    scheduler?: IModule;
} = {}) {
    const port = await freePort();
    const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
    const logger = createRecordingLogger(clock);
    const harness = buildHarness({
        env: {
            HOST: '127.0.0.1',
            PORT: String(port),
            CHAMVI_TOKENS: TOKENS,
            ...options.env,
        },
        agents: options.agents ?? [triage()],
        modules: [
            configModule({ clock, logger }),
            storeModule(),
            staticTokensModule(),
            engineModule(),
            options.scheduler ?? schedulerModule(),
            httpModule(),
            ...(options.modules ?? []),
        ],
    });
    harnesses.push(harness);
    return {
        harness,
        port,
        clock,
        logger,
        url: (path: string) => `http://127.0.0.1:${port}${path}`,
    };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

async function isFree(port: number): Promise<boolean> {
    try {
        await closeServer(await listenOn(port));
        return true;
    } catch {
        return false;
    }
}

describe('httpModule', () => {
    it('is named and depends on the engine and, optionally, static tokens', () => {
        const module = httpModule();
        expect(module.name).toBe(ModuleName.HTTP);
        expect(module.dependencies).toEqual([
            ModuleName.ENGINE,
            { name: ModuleName.STATIC_TOKENS, optional: true },
        ]);
    });

    it('contributes the http, mcp and webhook channels in start and job mode', async () => {
        const { harness } = await build();
        await harness.setup();
        expect(harness.container.resolveAll(AppToken.CHANNELS).map((channel) => channel.name))
            .toEqual(expect.arrayContaining(['http', 'mcp', 'webhook']));
    });

    it('serves /healthz and /readyz after start', async () => {
        const {
            harness,
            url,
            logger,
        } = await build();
        await harness.setup();

        expect((await fetch(url('/healthz'))).status).toBe(200);
        expect((await fetch(url('/readyz'))).status).toBe(200);
        expect(harness.container.has(AppToken.SERVER)).toBe(true);
        expect(harness.container.has(AppToken.SHUTDOWN)).toBe(true);
        expect(logger.entries.find((e) => e.msg === 'listening')).toBeDefined();
    });

    it('basePath prefixes health', async () => {
        const { harness, url } = await build({ env: { CHAMVI_BASE_PATH: '/api' } });
        await harness.setup();

        expect((await fetch(url('/api/healthz'))).status).toBe(200);
        expect((await fetch(url('/healthz'))).status).toBe(404);
    });

    it('contributed routes are served', async () => {
        const { harness, url } = await build({
            modules: [contributing('routes', (container) => {
                container.registerMany(AppToken.HTTP_ROUTES, {
                    useValue: {
                        method: 'GET',
                        path: '/x',
                        handler: async () => ({ status: 200, body: 'ok' }),
                    },
                });
            })],
        });
        await harness.setup();

        const response = await fetch(url('/x'));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok');
    });

    it('authenticators run in order', async () => {
        const seen: string[] = [];
        const { harness, url } = await build({
            modules: [contributing('later', (container) => {
                container.registerMany(AppToken.AUTHENTICATORS, {
                    useValue: {
                        name: 'later',
                        order: 10,
                        authenticator: async () => {
                            seen.push('later');
                            return undefined;
                        },
                    },
                });
            })],
        });
        await harness.setup();

        const me = await fetch(url('/me'), { headers: { authorization: `Bearer ${TOKEN}` } });
        expect(me.status).toBe(200);
        expect(await me.json()).toMatchObject({ id: 'ops' });
        // static tokens (order 0) resolved the principal before the later one ran
        expect(seen).toEqual([]);

        const unknown = await fetch(url('/me'), { headers: { authorization: 'Bearer an-unknown-token-value' } });
        expect(unknown.status).toBe(401);
        expect(seen).toEqual(['later']);
    });

    it('no authenticator fails setup', async () => {
        const { harness, port } = await build({ env: { CHAMVI_TOKENS: '' } });

        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('No authenticator: set CHAMVI_TOKENS, or add staticTokensModule(), authupModule() or oidcModule().');
        expect(await isFree(port)).toBe(true);
    });

    it('teardown follows createShutdown', async () => {
        const events: string[] = [];
        let readyz: () => Promise<number> = async () => 0;
        // a channel stands in for the cron channel: the drain stops it first
        const fakeScheduler: IModule = {
            name: ModuleName.SCHEDULER,
            async setup(container) {
                container.registerMany(AppToken.CHANNELS, {
                    useValue: {
                        name: 'cron',
                        start: async () => undefined,
                        stop: async () => {
                            events.push('channel stop');
                        },
                    },
                });
            },
        };
        const {
            harness,
            url,
            port,
        } = await build({
            scheduler: fakeScheduler,
            modules: [
                drainRecorder(events),
                hooks({
                    name: 'recorder',
                    stopping: async () => {
                        events.push(`readyz ${await readyz()}`);
                        events.push('stopping hook');
                    },
                    drained: () => {
                        events.push('drained hook');
                    },
                }),
            ],
        });
        readyz = async () => (await fetch(url('/readyz'))).status;
        await harness.setup();

        await harness.stop();
        expect(events).toEqual([
            'readyz 503',
            'stopping hook',
            'channel stop',
            'engine drained',
            // the engine module's own drain (a no-op now), then its drained hooks
            'engine drained',
            'drained hook',
        ]);
        expect(await isFree(port)).toBe(true);
    });

    it('an open SSE stream does not block teardown', async () => {
        const agent = defineAgent({
            name: 'triage',
            model: approvalModel('deploy'),
            instructions: 'triage',
            channels: [http.on()],
            tools: {
                deploy: defineTool({
                    inputSchema: z.object({}),
                    execute: async (_input, { context }) => {
                        await approve(context, { title: 'Deploy?' });
                        return 'deployed';
                    },
                }),
            },
        });
        const {
            harness,
            url,
            port,
        } = await build({ agents: [agent] });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await engine.dispatch({
            agent: 'triage',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await engine.idle();
        expect((await engine.getRun(runId))?.status).toBe('waiting');

        const response = await fetch(url(`/runs/${runId}/stream`), { headers: { authorization: `Bearer ${TOKEN}` } });
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain('run.updated');

        await harness.stop();

        // the stream ends
        let done = false;
        while (!done) {
            ({ done } = await reader.read());
        }
        expect(await isFree(port)).toBe(true);
    });

    it('port in use rejects onReady', async () => {
        const events: string[] = [];
        const { harness, port } = await build({ modules: [drainRecorder(events)] });
        const occupied = await listenOn(port);
        try {
            const error = await rejectionOf(harness.setup());
            expect((error as Error & { code?: string }).code).toBe('EADDRINUSE');
            // the harness tore down: the http module's shutdown drained the engine
            expect(events).toContain('engine drained');
        } finally {
            await closeServer(occupied);
        }
    });

    it('stop while binding', async () => {
        let harness: Harness | undefined;
        const built = await build({
            modules: [hooks({
                name: 'aborter',
                started: () => {
                    harness?.controller.abort(createStoppedError());
                },
            })],
        });
        ({ harness } = built);

        const error = await rejectionOf(harness.setup());
        expect((error as Error & { code?: string }).code).toBe(APP_ERROR_CODE.STOPPED);
        expect(harness.container.has(AppToken.SERVER)).toBe(false);
        expect(await isFree(built.port)).toBe(true);
    });
});
