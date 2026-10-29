/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { cron } from '@chamvi/channel-cron';
import { InvalidAgentDefinitionError, createMemoryStores, defineAgent } from '@chamvi/core';
import type { Agent, IChannel } from '@chamvi/core';
import { http, webhook } from '@chamvi/http';
import { ControllableClock } from '@chamvi/test-kit';
import type { IModule } from 'orkos';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    AppToken,
    configModule,
    createApp,
    engineModule,
    httpModule,
    schedulerModule,
    staticTokensModule,
    storeModule,
} from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import { TOKEN, TOKENS } from '../../utils/app.ts';
import { buildHarness } from '../../utils/harness.ts';
import type { Harness } from '../../utils/harness.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { textModel } from '../../utils/model.ts';
import { freePort } from '../../utils/port.ts';

let harnesses: Harness[] = [];
let apps: IApp[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    harnesses = [];
    apps = [];
});

function triage(): Agent {
    return defineAgent({
        name: 'triage',
        model: textModel(),
        instructions: 'triage',
        channels: [http.on(), webhook.on('/hook')],
    });
}

function contributing(name: string, ...channels: IChannel<any, any>[]): IModule {
    return {
        name,
        async setup(container) {
            for (const channel of channels) {
                container.registerMany(AppToken.CHANNELS, { useValue: channel });
            }
        },
    };
}

/** A channel recording its start and stop calls. */
function spyChannel(name: string, events: string[], extra: Partial<IChannel> = {}): IChannel {
    return {
        name,
        async start() {
            events.push(`${name} start`);
        },
        async stop() {
            events.push(`${name} stop`);
        },
        ...extra,
    };
}

async function build(options: { agents?: Agent[]; modules?: IModule[] } = {}) {
    const port = await freePort();
    const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
    const logger = createRecordingLogger(clock);
    const harness = buildHarness({
        env: {
            HOST: '127.0.0.1',
            PORT: String(port),
            CHAMVI_TOKENS: TOKENS,
        },
        agents: options.agents ?? [triage()],
        modules: [
            configModule({ clock, logger }),
            storeModule(),
            staticTokensModule(),
            engineModule(),
            schedulerModule(),
            httpModule(),
            ...(options.modules ?? []),
        ],
    });
    harnesses.push(harness);
    return {
        harness,
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

describe('channels', () => {
    it('the built-in modules register the agent, cron, http, mcp and webhook channels', async () => {
        const { harness } = await build();
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        expect(engine.listChannels().map((channel) => channel.name).sort()).toEqual(['agent', 'cron', 'http', 'mcp', 'webhook']);
    });

    it('a module\'s channel reaches the engine and, with in, the http app\'s mount', async () => {
        const echo: IChannel = {
            name: 'echo',
            in: async ({ request, subpath }) => new Response(`${request.method} ${subpath}`),
        };
        const quiet: IChannel = { name: 'quiet', out: async () => undefined };
        const { harness, url } = await build({ modules: [contributing('echo', echo, quiet)] });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        expect(engine.getChannel('echo')).toBe(echo);
        expect(engine.getChannel('quiet')).toBe(quiet);

        // unauthenticated: the channel checks its own credentials
        const served = await fetch(url('/channels/echo/a/b'), { method: 'POST' });
        expect(served.status).toBe(200);
        expect(await served.text()).toBe('POST /a/b');

        // out only: not mounted
        const unserved = await fetch(url('/channels/quiet'), { method: 'POST' });
        expect(unserved.status).toBe(404);
    });

    it('the webhook channel authenticates with the app\'s authenticators', async () => {
        const { harness, url } = await build();
        await harness.setup();

        const post = (headers: Record<string, string>) => fetch(url('/channels/webhook/triage/hook'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ hello: 'world' }),
        });

        expect((await post({})).status).toBe(401);

        const accepted = await post({ authorization: `Bearer ${TOKEN}` });
        expect(accepted.status).toBe(202);
        const { runId } = await accepted.json() as { runId: string };
        const run = await harness.container.resolve(AppToken.ENGINE).getRun(runId);
        expect(run?.trigger).toMatchObject({ channel: 'webhook', payload: { hello: 'world' } });
    });

    it('engine.start() starts the contributed channels and the teardown stops them', async () => {
        const events: string[] = [];
        const { harness } = await build({ modules: [contributing('spy', spyChannel('spy', events))] });
        await harness.setup();
        expect(events).toEqual(['spy start']);

        await harness.stop();
        expect(events).toEqual(['spy start', 'spy stop']);
    });

    it('two channels with one name fail setup with InvalidAgentDefinitionError', async () => {
        const events: string[] = [];
        const { harness } = await build({
            modules: [
                contributing('one', spyChannel('twin', events)),
                contributing('two', spyChannel('twin', events)),
            ],
        });

        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('"twin"');
        expect(events).toEqual([]);
    });

    it('a subscription of a channel no module contributes fails setup', async () => {
        const agent = defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'triage',
            channels: [{
                channel: 'slack', 
                id: 'slack', 
                options: {}, 
            }],
        });
        const { harness } = await build({ agents: [agent] });

        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('slack');
    });

    it('run-job starts no channel', async () => {
        const events: string[] = [];
        const clock = new ControllableClock(new Date('2026-10-21T08:00:00Z'));
        const app = createApp({
            agents: [defineAgent({
                name: 'sweep',
                model: textModel(),
                instructions: 'x',
                channels: [cron.on('*/5 * * * *')],
            })],
            modules: [
                configModule({ clock, logger: createRecordingLogger(clock) }),
                storeModule({ stores: createMemoryStores({ clock }) }),
                contributing('spy', spyChannel('spy', events)),
            ],
        });
        apps.push(app);

        const result = await app.runJob({ env: {}, agent: 'sweep' });

        expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
        expect(events).toEqual([]);
    });
});
