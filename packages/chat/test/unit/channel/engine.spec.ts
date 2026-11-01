/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { jsonSchema } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { defineAgent, defineTool } from '@chamvi/core';
import type {
    Agent,
    IEngine,
    IStore,
    Run,
} from '@chamvi/core';
import { CHAT_REQUEST_ERROR_CODE, chatAddress } from '@chamvi/chat';
import type { ChatApprovalRef, ChatChannel } from '@chamvi/chat';
import { mockModel } from '@chamvi/test-kit';
import type { MockResponse } from '@chamvi/test-kit';
import { createTextMessage } from '../../utils/adapter.ts';
import { createIntakeFixture } from '../../utils/intake.ts';
import type { IntakeFixture, IntakeFixtureInput } from '../../utils/intake.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

const SOURCE = chatAddress({ adapter: 'fake', threadId: 'fake:chat-1' });
const OTHER = chatAddress({ adapter: 'fake', threadId: 'fake:chat-2' });
const APPROVAL_URL = (ref: ChatApprovalRef) => `https://chamvi.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}`;

type Act = (context: Parameters<NonNullable<Parameters<typeof defineTool>[0]['execute']>>[1]['context']) => Promise<unknown>;

/** an agent whose tool `act` runs `act` once, then answers */
function agentWith(channel: ChatChannel, act: Act, turns: MockResponse[] = []): Agent {
    const tool = defineTool({
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async (_input, { context }) => act(context),
    });

    return defineAgent({
        name: 'helper',
        model: mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'act',
                    input: {},
                }],
            },
            ...turns,
            { parts: [{ type: 'text', text: 'done' }] },
        ]),
        instructions: 'Help.',
        tools: { act: tool },
        channels: [channel.on()],
    });
}

async function started(input: IntakeFixtureInput): Promise<IntakeFixture> {
    const fixture = createIntakeFixture(input);

    engines.push(fixture.engine);
    await fixture.engine.start();

    return fixture;
}

/** delivers one message from the source chat and waits for its run to settle or pause */
async function trigger(fixture: IntakeFixture, text = 'hello'): Promise<Run> {
    await fixture.adapter.deliver(createTextMessage({ id: 'm-1', text }));
    await fixture.engine.idle();

    const [run] = await fixture.runs();

    return run!;
}

/** effects.save fails once for an emit effect */
function failEmitSaveOnce(memory: IStore): IStore {
    let failed = false;

    return {
        ...memory,
        effects: {
            findOne: (key) => memory.effects.findOne(key),
            findOneOrFail: (key) => memory.effects.findOneOrFail(key),
            save: async (key, result) => {
                if (key.includes(':emit:') && !failed) {
                    failed = true;

                    throw new Error('effect write failed');
                }

                return memory.effects.save(key, result);
            },
        },
    };
}

describe('chat channel out on an engine', () => {
    it('source_and_explicit_target: replies to the source chat and sends to another one (trusted channel)', async () => {
        const fixture = await started({
            patch: { untrusted: false },
            agents: (channel) => [agentWith(channel, async (context) => {
                const handle = context.channels.findOneOrFail('chat');

                await handle.emit({ body: 'Reply.' });
                await handle.emit({ title: 'FYI', body: 'Forwarded.' }, OTHER);
            })],
        });
        const run = await trigger(fixture);

        expect(run.status).toBe('completed');
        expect(run.address).toBe(SOURCE);
        expect(fixture.adapter.posts).toEqual([
            { threadId: 'fake:chat-1', message: { raw: 'Reply.' } },
            { threadId: 'fake:chat-2', message: { raw: 'FYI\n\nForwarded.' } },
        ]);
    });

    it('source_and_explicit_target: a tainted run reaches its source ungated, another chat only through the gate', async () => {
        const fixture = await started({
            patch: { approvalUrl: APPROVAL_URL },
            agents: (channel) => [agentWith(channel, async (context) => {
                const handle = context.channels.findOneOrFail('chat');

                await handle.emit({ body: 'Reply.' });
                await handle.emit({ body: 'the private plan' }, OTHER);
            })],
        });
        const run = await trigger(fixture, 'trigger text of the user');

        expect(run.status).toBe('waiting');
        expect(run.taint?.source).toBe('channel:chat');
        // the reply, then the gate's notice to the source; nothing reached the other chat
        expect(fixture.adapter.posts.map((post) => post.threadId)).toEqual(['fake:chat-1', 'fake:chat-1']);

        const notice = (fixture.adapter.posts[1]!.message as { raw: string }).raw;

        expect(notice).not.toContain('the private plan');
        expect(notice).not.toContain('trigger text of the user');
        expect(notice).toContain(`run=${run.id}&approval=`);
    });

    it('same_emit_record_sends_once: the emit effect (core) turns a repeated emit into one post', async () => {
        const fixture = await started({
            agents: (channel) => [agentWith(channel, async (context) => {
                const handle = context.channels.findOneOrFail('chat');

                await handle.emit({ body: 'Once.', key: 'greeting' });
                await handle.emit({ body: 'Once.', key: 'greeting' });
            })],
        });
        const run = await trigger(fixture);

        expect(run.status).toBe('completed');
        expect(fixture.adapter.posts).toEqual([{ threadId: 'fake:chat-1', message: { raw: 'Once.' } }]);
        expect(await fixture.store.effects.findOne(`${run.id}:emit:chat:key:greeting`)).toBeDefined();
    });

    it('send_failure_records_no_effect: a failed post is a tool error and records nothing; the next emit sends', async () => {
        const seen: unknown[] = [];
        let store!: IStore;
        const fixture = await started({
            agents: (channel) => [agentWith(channel, async (context) => {
                const handle = context.channels.findOneOrFail('chat');

                try {
                    await handle.emit({ body: 'Retry me.', key: 'k' });
                } catch (error) {
                    seen.push(error);
                }

                seen.push(await store.effects.findOne(`${context.run.runId}:emit:chat:key:k`));
                await handle.emit({ body: 'Retry me.', key: 'k' });
            })],
        });

        store = fixture.store;

        const post = fixture.adapter.postMessage.bind(fixture.adapter);
        let calls = 0;

        fixture.adapter.postMessage = (threadId, message) => {
            calls += 1;

            return calls === 1 ? Promise.reject(new Error('socket closed')) : post(threadId, message);
        };

        const run = await trigger(fixture);

        expect(run.status).toBe('completed');
        expect((seen[0] as { code?: string }).code).toBe(CHAT_REQUEST_ERROR_CODE);
        expect(seen[1]).toBeUndefined();
        expect(fixture.adapter.posts).toEqual([{ threadId: 'fake:chat-1', message: { raw: 'Retry me.' } }]);
    });

    it('effect_write_failure_may_resend: a post whose record failed is sent again (at-least-once, never exactly-once)', async () => {
        const fixture = await started({
            store: failEmitSaveOnce,
            agents: (channel) => [agentWith(channel, async (context) => {
                const handle = context.channels.findOneOrFail('chat');

                await handle.emit({ body: 'Maybe twice.', key: 'k' }).catch(() => undefined);
                await handle.emit({ body: 'Maybe twice.', key: 'k' });
            })],
        });
        const run = await trigger(fixture);

        expect(run.status).toBe('completed');
        expect(fixture.adapter.posts).toEqual([
            { threadId: 'fake:chat-1', message: { raw: 'Maybe twice.' } },
            { threadId: 'fake:chat-1', message: { raw: 'Maybe twice.' } },
        ]);
    });

    it('sends an approval link (ids only, no details, no buttons) and only core answers it', async () => {
        const decisions: unknown[] = [];
        const fixture = await started({
            patch: { approvalUrl: APPROVAL_URL },
            agents: (channel) => [agentWith(channel, async (context) => {
                const decision = await context.channels.findOneOrFail('chat').approve({
                    title: 'Release which version?',
                    body: 'Pick one.',
                    options: [
                        {
                            id: 'v1',
                            label: 'Version 1',
                            detail: 'PRIVATE DETAIL',
                        },
                        { id: 'v2', label: 'Version 2' },
                    ],
                });

                decisions.push(decision);

                return 'ok';
            })],
        });
        const run = await trigger(fixture, 'please release secret-xyz');

        expect(run.status).toBe('waiting');
        expect(run.waiting?.notifiedAt).toBeInstanceOf(Date);
        expect(fixture.adapter.posts).toHaveLength(1);

        const post = fixture.adapter.posts[0]!;
        const { approvalId } = (run.waiting!);

        // plain raw text: no card, no buttons, no action ids
        expect(Object.keys(post.message as object)).toEqual(['raw']);

        const text = (post.message as { raw: string }).raw;

        expect(text).toBe([
            'Release which version?',
            'Pick one.',
            'Options (choose one):\n- v1: Version 1\n- v2: Version 2',
            `Expires: ${run.waiting!.expiresAt.toISOString()}\nChoose and approve or deny: ${APPROVAL_URL({
                runId: run.id,
                approvalId,
                agent: 'helper',
            })}`,
        ].join('\n\n'));
        expect(text).not.toContain('PRIVATE DETAIL');
        expect(text).not.toContain('secret-xyz');

        // a platform action (a button press) answers nothing
        await fixture.adapter.chat?.processAction({
            actionId: 'v1',
            adapter: fixture.ingress,
            messageId: 'sent-1',
            raw: {},
            threadId: 'fake:chat-1',
            user: {
                userId: 'user-1',
                userName: 'user',
                fullName: 'User',
                isBot: false,
                isMe: false,
            },
            value: approvalId,
        }, undefined);
        await fixture.engine.idle();
        expect((await fixture.engine.getRun(run.id))?.status).toBe('waiting');

        // the UI's answer goes through core's approve()
        await fixture.engine.approve(run.id, {
            approvalId,
            approved: true,
            selected: ['v1'],
        });
        await fixture.engine.idle();

        expect((await fixture.engine.getRun(run.id))?.status).toBe('completed');
        expect(decisions).toEqual([expect.objectContaining({ approved: true, selected: ['v1'] })]);
        expect(fixture.adapter.posts).toHaveLength(1);
    });
});
