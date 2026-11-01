/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    ChamviError,
    ErrorCode,
    defineAgent,
} from '@chamvi/core';
import type {
    Agent,
    IEngine,
    IStore,
    Run,
} from '@chamvi/core';
import { CHAT_INTAKE_FAILED_ERROR_CODE, chatAddress } from '@chamvi/chat';
import type { ChatChannel } from '@chamvi/chat';
import { mockModel, textModel } from '@chamvi/test-kit';
import { createTextMessage } from '../../utils/adapter.ts';
import { createIntakeFixture, flush } from '../../utils/intake.ts';
import type { IntakeFixture, IntakeFixtureInput } from '../../utils/intake.ts';
import { hashKey } from '../../../src/channel/helpers.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

function plain(channel: ChatChannel, name: string): Agent {
    return defineAgent({
        name,
        model: textModel(),
        instructions: 'Answer.',
        channels: [channel.on()],
    });
}

async function started(input: IntakeFixtureInput): Promise<IntakeFixture> {
    const fixture = createIntakeFixture(input);

    engines.push(fixture.engine);
    await fixture.engine.start();

    return fixture;
}

/** runs.insert fails once for the agent named, every other repository call goes through */
function failInsertOnce(agent: string, inserts: string[]) {
    return (memory: IStore): IStore => {
        let failed = false;

        return {
            ...memory,
            runs: new Proxy(memory.runs, {
                get(target, key, receiver) {
                    if (key === 'insert') {
                        return async (run: Run) => {
                            inserts.push(run.agent);

                            if (run.agent === agent && !failed) {
                                failed = true;

                                throw new Error('store write failed');
                            }

                            return target.insert(run);
                        };
                    }

                    const value: unknown = Reflect.get(target, key, receiver);

                    return typeof value === 'function' ? value.bind(target) : value;
                },
            }),
        };
    };
}

describe('chat intake on an engine', () => {
    it('same_event_creates_one_run', async () => {
        const fixture = await started({ agents: (channel) => [plain(channel, 'assistant')] });
        const message = createTextMessage({ id: 'm-1' });

        await fixture.adapter.deliver(message);
        await fixture.adapter.deliver(message);
        fixture.adapter.deliverIgnored(message);
        await flush();

        const runs = await fixture.runs();

        expect(runs).toHaveLength(1);
        expect(runs[0]?.trigger.idempotencyKey).toBe(hashKey(['chat', 'fake', 'fake:chat-1', 'user-1', 'm-1']));
        expect(fixture.errors).toEqual([]);
    });

    it('one message id of two authors in one chat starts two runs', async () => {
        const fixture = await started({ agents: (channel) => [plain(channel, 'assistant')] });

        // concurrent deliveries: the in-flight key must tell the authors apart too
        fixture.adapter.deliverIgnored(createTextMessage({ id: 'm-1', author: 'user-1' }));
        fixture.adapter.deliverIgnored(createTextMessage({ id: 'm-1', author: 'user-2' }));
        await flush();

        const runs = await fixture.runs();

        expect(runs.map((run) => (run.trigger.payload as { message: { author: { id: string } } }).message.author.id).sort())
            .toEqual(['user-1', 'user-2']);
        expect(fixture.errors).toEqual([]);
    });

    it('partial_multi_agent_failure_retries_only_missing_run', async () => {
        const inserts: string[] = [];
        const fixture = await started({
            agents: (channel) => [plain(channel, 'alpha'), plain(channel, 'beta')],
            store: failInsertOnce('beta', inserts),
            patch: {
                resolveInvoker: () => ({
                    id: 'owner',
                    kind: 'chat',
                    permissions: ['agent:alpha:run'],
                }),
            },
        });
        const delivery = fixture.adapter.deliver(createTextMessage({ id: 'm-1' }));

        await vi.waitFor(() => expect(inserts).toEqual(['alpha', 'beta']));
        expect((await fixture.runs()).map((run) => run.agent)).toEqual(['alpha']);

        fixture.clock.advance(1000);
        await delivery;

        // only the missing run is written again: alpha was not dispatched a second time
        expect(inserts).toEqual(['alpha', 'beta', 'beta']);

        const runs = await fixture.runs();
        const address = chatAddress({ adapter: 'fake', threadId: 'fake:chat-1' });

        expect(runs.map((run) => run.agent).sort()).toEqual(['alpha', 'beta']);

        for (const run of runs) {
            expect(run.trigger.channel).toBe('chat');
            expect(run.address).toBe(address);
            expect(run.trigger.invoker).toEqual({
                id: 'owner',
                kind: 'chat',
                permissions: ['agent:alpha:run'],
            });
            expect(JSON.stringify(run)).not.toMatch(/"raw"|"formatted"/);
        }

        expect(fixture.errors).toEqual([]);
    });

    it('replacement_and_removal_read_live', async () => {
        const inserts: string[] = [];
        const fixture = await started({
            agents: (channel) => [plain(channel, 'alpha'), plain(channel, 'beta')],
            store: failInsertOnce('beta', inserts),
        });
        const delivery = fixture.adapter.deliver(createTextMessage({ id: 'm-1' }));

        await vi.waitFor(() => expect(inserts).toEqual(['alpha', 'beta']));

        // beta goes away before its retry: the retry reads the live agents
        await fixture.engine.removeAgent('beta');
        fixture.clock.advance(1000);
        await delivery;

        expect((await fixture.runs()).map((run) => run.agent)).toEqual(['alpha']);

        // alpha replaced by a version listening to group chatter only
        await fixture.engine.putAgent(defineAgent({
            name: 'alpha',
            model: textModel(),
            instructions: 'Answer.',
            channels: [fixture.channel.on({ events: ['message'] })],
        }));
        await fixture.adapter.deliver(createTextMessage({ id: 'm-2' }));

        expect((await fixture.runs()).map((run) => run.agent)).toEqual(['alpha']);
        expect(fixture.errors).toEqual([]);
    });

    it('run_is_tainted_from_channel', async () => {
        const fixture = await started({ agents: (channel) => [plain(channel, 'assistant')] });

        await fixture.adapter.deliver(createTextMessage({ id: 'm-1' }));

        const [run] = await fixture.runs();

        expect(run?.taint?.source).toBe('channel:chat');
    });
});

describe('chat intake with conversations', () => {
    function remembering(channel: ChatChannel, model = textModel()): Agent {
        return defineAgent({
            name: 'remembering',
            model,
            instructions: 'Answer.',
            conversation: true,
            channels: [channel.on()],
        });
    }

    it('conversation_agent_binds_conversation', async () => {
        const model = mockModel([
            { parts: [{ type: 'text', text: 'noted' }] },
            { parts: [{ type: 'text', text: 'you said it' }] },
        ]);
        const fixture = await started({ agents: (channel) => [remembering(channel, model)] });

        await fixture.adapter.deliver(createTextMessage({ id: 'm-1', text: 'my favourite colour is teal' }));
        await fixture.engine.idle();
        await fixture.adapter.deliver(createTextMessage({ id: 'm-2', text: 'what did I tell you?' }));
        await fixture.engine.idle();

        const runs = await fixture.runs();

        expect(runs.map((run) => run.status)).toEqual(['completed', 'completed']);
        expect(runs[0]?.conversation?.text).toBe('my favourite colour is teal');
        expect(runs[0]?.conversation?.scope.identity).toEqual({
            agent: 'remembering',
            channel: 'chat',
            account: 'fake',
            chat: 'fake:chat-1',
            audience: 'direct:user-1',
        });
        expect(runs[1]?.conversation?.scope.id).toBe(runs[0]?.conversation?.scope.id);
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('my favourite colour is teal');

        const second = JSON.stringify(model.doStreamCalls[1]?.prompt);

        expect(second).toContain('what did I tell you?');
        expect(second).toContain('my favourite colour is teal');
        expect(fixture.errors).toEqual([]);
        expect(fixture.engineErrors).toEqual([]);
    });

    it('plain_agent_uses_dispatch', async () => {
        const fixture = await started({ agents: (channel) => [remembering(channel), plain(channel, 'plain')] });

        await fixture.adapter.deliver(createTextMessage({ id: 'm-1' }));

        const runs = await fixture.runs();
        const bound = runs.find((run) => run.agent === 'remembering');
        const unbound = runs.find((run) => run.agent === 'plain');

        expect(runs).toHaveLength(2);
        expect(bound?.conversation).toBeDefined();
        expect(bound?.trigger.concurrencyKey).not.toBe(hashKey(['chat', 'fake', 'fake:chat-1']));
        expect(unbound).not.toHaveProperty('conversation');
        expect(unbound?.trigger.concurrencyKey).toBe(hashKey(['chat', 'fake', 'fake:chat-1']));
        expect(bound?.trigger.idempotencyKey).toBe(unbound?.trigger.idempotencyKey);
        // only the bound agent went through the conversation policy at intake
        expect(fixture.access.filter((item) => item.operation === 'dispatch').map((item) => item.agent)).toEqual(['remembering']);
    });

    it('group_and_direct_audiences_differ', async () => {
        const fixture = await started({
            agents: (channel) => [remembering(channel)],
            patch: { account: 'support-line' },
        });

        fixture.adapter.isDirect = (threadId) => threadId.startsWith('fake:dm');
        await fixture.adapter.deliver(createTextMessage({ id: 'm-1', thread: 'dm-1' }));
        await fixture.adapter.deliver(createTextMessage({
            id: 'm-2',
            thread: 'group-1',
            isMention: true,
        }));
        await fixture.adapter.deliver(createTextMessage({
            id: 'm-3',
            thread: 'group-1',
            isMention: true,
            author: 'user-2',
        }));

        const identities = (await fixture.runs()).map((run) => run.conversation?.scope.identity);

        expect(identities.map((identity) => identity?.audience)).toEqual(['direct:user-1', 'group:fake:group-1', 'group:fake:group-1']);
        expect(identities.map((identity) => identity?.account)).toEqual(['support-line', 'support-line', 'support-line']);
        expect(identities.map((identity) => identity?.chat)).toEqual(['fake:dm-1', 'fake:group-1', 'fake:group-1']);
    });

    it('conversation_policy_denial_is_reported_not_retried_forever', async () => {
        const fixture = await started({
            agents: (channel) => [remembering(channel), plain(channel, 'plain')],
            authorize: () => false,
        });

        const error = await fixture.adapter.deliver(createTextMessage({ id: 'm-1', text: 'secret words' })).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe(CHAT_INTAKE_FAILED_ERROR_CODE);
        expect((error as Error).message).toMatch(/remembering/);
        expect((error as Error).message).toMatch(/1 attempt/);
        expect((error as Error).message).not.toContain('secret words');
        expect(((error as Error).cause as ChamviError).code).toBe(ErrorCode.VALIDATION);
        expect(fixture.errors).toEqual([error]);

        fixture.clock.advance(60_000);
        await flush();

        expect(fixture.access).toHaveLength(1);
        expect(fixture.errors).toHaveLength(1);
        // the plain agent still got its run
        expect((await fixture.runs()).map((run) => run.agent)).toEqual(['plain']);
    });

    it('a transport without a conversation for the message refuses the bound agent only, once', async () => {
        const fixture = await started({
            agents: (channel) => [remembering(channel), plain(channel, 'plain')],
            hooks: { conversationTarget: () => undefined },
        });

        const error = await fixture.adapter.deliver(createTextMessage({ id: 'm-1', text: 'secret words' })).catch((caught: unknown) => caught);

        expect((error as ChamviError).code).toBe(CHAT_INTAKE_FAILED_ERROR_CODE);
        expect((error as Error).message).toMatch(/remembering/);
        expect((error as Error).message).toMatch(/1 attempt/);
        expect((error as Error).message).not.toContain('secret words');
        expect(((error as Error).cause as ChamviError).code).toBe(ErrorCode.VALIDATION);
        expect(fixture.errors).toEqual([error]);

        fixture.clock.advance(60_000);
        await flush();

        // terminal: no retry, no conversation policy call, the plain agent still ran
        expect(fixture.errors).toHaveLength(1);
        expect(fixture.access).toEqual([]);
        expect((await fixture.runs()).map((run) => run.agent)).toEqual(['plain']);
    });
});
