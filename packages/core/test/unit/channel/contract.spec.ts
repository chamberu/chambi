/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    Engine,
    InvalidAgentDefinitionError,
    TRIGGER_KEY_MAX_LENGTH,
    ValidationError,
    defineAgent,
} from '@chamvi/core';
import type {
    ChannelContext,
    ChannelSubscription,
    EngineOptions,
    IChannel,
    Run,
} from '@chamvi/core';
import { createMemoryStores } from '../../../src/store/index.ts';

const model = {} as LanguageModel;

const subscription = (channel: string, id = channel): ChannelSubscription => ({
    channel,
    id,
    options: {},
});

const agent = defineAgent({
    name: 'triage',
    model,
    instructions: 'x',
});

/** Engine whose executions block until released, to observe what drain() does first. */
class GatedEngine extends Engine {
    gates = new Map<string, () => void>();

    protected override async execute(run: Run): Promise<void> {
        await new Promise<void>((resolve) => {
            this.gates.set(run.id, resolve);
        });
        await this.finish(run.id, { status: 'completed' });
    }

    async release(id: string): Promise<void> {
        await vi.waitFor(() => expect(this.gates.has(id)).toBe(true));
        this.gates.get(id)!();
        this.gates.delete(id);
    }
}

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
    vi.restoreAllMocks();
});

function make(opts: Partial<EngineOptions> = {}) {
    const engine = new GatedEngine({
        stores: createMemoryStores(),
        agents: [agent],
        onError: () => {},
        ...opts,
    });
    engines.push(engine);
    return engine;
}

/** A channel recording its start/stop calls into `log` and keeping the context it was started with. */
function recording(name: string, log: string[], extra: Partial<IChannel> = {}) {
    const channel: IChannel & { ctx?: ChannelContext } = {
        name,
        async start(ctx) {
            log.push(`start:${name}`);
            channel.ctx = ctx;
        },
        async stop() {
            log.push(`stop:${name}`);
        },
        ...extra,
    };
    return channel;
}

describe('channels on the engine', () => {
    it('refuses two channels with one name', () => {
        expect(() => make({ channels: [{ name: 'a' }, { name: 'a' }] }))
            .toThrow(InvalidAgentDefinitionError);
        expect(() => make({ channels: [{ name: 'a' }, { name: 'a' }] }))
            .toThrow(/channel "a"/);
    });

    it('refuses a channel name that breaks the agent-name rule', () => {
        expect(() => make({ channels: [{ name: 'Bad Name' }] })).toThrow(InvalidAgentDefinitionError);
        expect(() => make({ channels: [{ name: 'x'.repeat(65) }] })).toThrow(InvalidAgentDefinitionError);
        expect(() => make({ channels: [{ name: 'good-name' }] })).not.toThrow();
    });

    it('lists and gets the registered channels', () => {
        const a = { name: 'a' };
        const b = { name: 'b' };
        const engine = make({ channels: [a, b] });
        expect(engine.listChannels()).toEqual([a, b]);
        expect(engine.listChannels()).not.toBe(engine.listChannels());
        expect(engine.getChannel('b')).toBe(b);
        expect(engine.getChannel('c')).toBeUndefined();
    });

    it('refuses a subscription naming an unregistered channel (constructor and putAgent)', async () => {
        const subscribed = defineAgent({
            name: 'digest',
            model,
            instructions: 'x',
            channels: [subscription('cron')],
        });
        expect(() => make({ agents: [subscribed] })).toThrow(InvalidAgentDefinitionError);
        expect(() => make({ agents: [subscribed] })).toThrow(/unknown channel "cron"/);

        const engine = make({ channels: [{ name: 'http' }] });
        await expect(engine.putAgent(subscribed)).rejects.toThrow(/unknown channel "cron"/);
        expect(engine.getAgent('digest')).toBeUndefined();

        const ok = make({ channels: [{ name: 'cron' }], agents: [subscribed] });
        expect(ok.getAgent('digest')).toBe(subscribed);
    });

    it('start() starts every channel after recover, start({ channels: false }) starts none', async () => {
        const log: string[] = [];
        const engine = make({ channels: [recording('a', log), recording('b', log)] });
        const recover = engine.recover.bind(engine);
        vi.spyOn(engine, 'recover').mockImplementation(async () => {
            log.push('recover');
            return recover();
        });
        await engine.start();
        expect(log).toEqual(['recover', 'start:a', 'start:b']);

        const quiet: string[] = [];
        const other = make({ channels: [recording('a', quiet)] });
        await other.start({ channels: false });
        expect(quiet).toEqual([]);
        await other.drain();
        expect(quiet).toEqual([]);
    });

    it('a throwing start rejects start() after stopping the channels already started', async () => {
        const log: string[] = [];
        const failure = new Error('socket refused');
        const engine = make({
            channels: [
                recording('a', log),
                recording('b', log, {
                    async start() {
                        log.push('start:b');
                        throw failure;
                    },
                }),
                recording('c', log),
            ],
        });
        await expect(engine.start()).rejects.toBe(failure);
        expect(log).toEqual(['start:a', 'start:b', 'stop:a']);
    });

    it('drain() stops channels before waiting for runs; a throwing stop goes to onError and the drain goes on', async () => {
        const log: string[] = [];
        const onError = vi.fn();
        const failure = new Error('stop failed');
        const engine = make({
            onError,
            channels: [
                recording('a', log, {
                    async stop() {
                        log.push('stop:a');
                        throw failure;
                    },
                }),
                recording('b', log),
            ],
        });
        await engine.start();
        const { runId } = await engine.dispatch({
            agent: 'triage',
            trigger: 't',
            channel: 'a',
            payload: {},
        });
        await vi.waitFor(() => expect(engine.gates.has(runId)).toBe(true));

        const drained = engine.drain();
        await vi.waitFor(() => expect(log).toContain('stop:b'));
        expect(log).toContain('stop:a');
        // the run is still executing: channels stopped first
        expect(engine.gates.has(runId)).toBe(true);
        await engine.release(runId);
        await drained;

        expect(onError).toHaveBeenCalledWith(failure);
        expect((await engine.getRun(runId))?.status).toBe('completed');
        // stopped once per start
        expect(log.filter((l) => l.startsWith('stop:'))).toEqual(['stop:a', 'stop:b']);
    });

    it('stop() stops the started channels and resolves once they stopped', async () => {
        const log: string[] = [];
        let finish: (() => void) | undefined;
        const slow: IChannel = {
            name: 'slow',
            start: async () => {},
            stop: () => new Promise<void>((resolve) => {
                finish = () => {
                    log.push('stopped:slow');
                    resolve();
                };
            }),
        };
        const engine = make({ channels: [recording('a', log), slow] });
        await engine.start();
        let resolved = false;
        const stopping = engine.stop().then(() => {
            resolved = true;
        });
        await vi.waitFor(() => expect(finish).toBeDefined());
        expect(log).toContain('stop:a');
        expect(resolved).toBe(false);
        finish!();
        await stopping;
        expect(log).toContain('stopped:slow');
    });

    it('refuses a defaultAddress that is no non-empty string', () => {
        expect(() => make({ channels: [{ name: 'a', defaultAddress: '' }] })).toThrow(InvalidAgentDefinitionError);
        expect(() => make({ channels: [{ name: 'a', defaultAddress: 7 as never }] })).toThrow(/defaultAddress/);
        expect(() => make({ channels: [{ name: 'a', defaultAddress: 'C1' }] })).not.toThrow();
    });

    it('ctx.dispatch sets channel to the channel\'s name', async () => {
        const log: string[] = [];
        const a = recording('a', log);
        const engine = make({ channels: [a] });
        await engine.start({ channels: true });
        const { runId } = await a.ctx!.dispatch({
            agent: 'triage',
            trigger: 't',
            payload: {},
            ...{ channel: 'other' } as Record<string, unknown>,
        } as Parameters<ChannelContext['dispatch']>[0]);
        expect((await engine.getRun(runId))?.trigger.channel).toBe('a');
        expect(a.ctx!.engine).toBe(engine);
    });

    it('idempotency scope is <agent>:<channel>: two channels with the same key get two runs', async () => {
        const engine = make({ channels: [{ name: 'a' }, { name: 'b' }] });
        const base = {
            agent: 'triage',
            trigger: 't',
            payload: {},
            idempotencyKey: 'k',
        };
        const first = await engine.dispatch({ ...base, channel: 'a' });
        const second = await engine.dispatch({ ...base, channel: 'b' });
        const again = await engine.dispatch({ ...base, channel: 'a' });
        expect(second.runId).not.toBe(first.runId);
        expect(again).toEqual({ runId: first.runId, deduplicated: true });

        const invoker = {
            id: 'u1',
            kind: 'token',
            permissions: [],
        };
        const scoped = await engine.dispatch({
            ...base,
            channel: 'a',
            invoker,
        });
        expect(scoped.deduplicated).toBe(false);
    });

    it('dispatch stores address and refuses an address over 255 chars or with NUL', async () => {
        const engine = make();
        const base = {
            agent: 'triage',
            trigger: 't',
            channel: 'github',
            payload: {},
        };
        const { runId } = await engine.dispatch({ ...base, address: 'o/r#12' });
        const run = await engine.getRun(runId);
        expect(run?.address).toBe('o/r#12');
        expect(run?.trigger.address).toBe('o/r#12');

        for (const address of ['k'.repeat(TRIGGER_KEY_MAX_LENGTH + 1), 'a\u0000b']) {
            await expect(engine.dispatch({ ...base, address })).rejects.toBeInstanceOf(ValidationError);
            await expect(engine.dispatch({ ...base, address })).rejects.toThrow(/address/);
        }
    });
});
