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
} from 'vitest';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import type { IEngine, Run } from '@chamvi/core';
import { createWhatsAppChat } from '@chamvi/chat/baileys';
import type { WhatsAppChatOptions, WhatsAppIdentity } from '@chamvi/chat/baileys';
import { textModel } from '@chamvi/test-kit';
import { toConversationTarget } from '../../../src/baileys/policy.ts';
import { createRecordingAuth } from '../../utils/auth.ts';
import { createMemoryState } from '../../utils/chat.ts';
import {
    ALICE,
    BOT_JID,
    BOT_LID,
    GROUP,
    MALLORY,
    createWhatsAppFixture,
    settle,
    waMessage,
} from '../../utils/whatsapp.ts';
import type { WhatsAppFixture, WhatsAppFixtureInput } from '../../utils/whatsapp.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

async function started(input: WhatsAppFixtureInput = {}): Promise<WhatsAppFixture> {
    const value = createWhatsAppFixture(input);

    engines.push(value.engine);
    await value.engine.start();
    value.sockets.last().open();

    return value;
}

async function senders(value: WhatsAppFixture): Promise<string[]> {
    await settle();

    return (await value.runs()).map((run: Run) => (run.trigger.payload as { message: { author: { id: string } } }).message.author.id);
}

function baseOptions(): WhatsAppChatOptions {
    return {
        account: 'support',
        auth: createRecordingAuth().provider,
        policy: { senders: [ALICE] },
        resolveInvoker: () => ({
            id: 'a',
            kind: 'whatsapp',
            permissions: [],
        }),
        state: createMemoryState(),
        approvalUrl: () => 'https://chamvi.example/ui/approvals',
        onPairing: () => undefined,
    };
}

describe('createWhatsAppChat options', () => {
    it.each([
        ['policy', { policy: undefined }],
        ['policy', { policy: {} }],
        ['policy', { policy: { senders: [ALICE], open: true } }],
        ['policy.senders', { policy: { senders: ['491701111111'] } }],
        ['policy.senders', { policy: { senders: ['491701111111:12@s.whatsapp.net'] } }],
        // a group jid is no participant id
        ['policy.senders', { policy: { senders: [GROUP] } }],
        ['policy.groups', { policy: { senders: [ALICE], groups: [ALICE] } }],
        ['policy.requireGroupMention', { policy: { senders: [ALICE], requireGroupMention: 'yes' } }],
        ['approvalUrl', { approvalUrl: undefined }],
        ['resolveInvoker', { resolveInvoker: undefined }],
        ['onPairing', { onPairing: undefined }],
        ['auth', { auth: {} }],
        ['account', { account: '' }],
        ['state', { state: undefined }],
    ])('refuses an invalid %s', (name, patch) => {
        expect(() => createWhatsAppChat({ ...baseOptions(), ...patch } as WhatsAppChatOptions))
            .toThrow(InvalidAgentDefinitionError);
        expect(() => createWhatsAppChat({ ...baseOptions(), ...patch } as WhatsAppChatOptions))
            .toThrow(name);
    });

    it('never echoes a refused policy entry', () => {
        expect(() => createWhatsAppChat({ ...baseOptions(), policy: { senders: ['secret-491701111111'] } }))
            .toThrow(expect.objectContaining({ message: expect.not.stringContaining('secret') }) as Error);
    });
});

describe('WhatsApp sender and group policy', () => {
    it('allows a listed direct sender only', async () => {
        const value = await started();

        value.sockets.last().deliver(
            waMessage({ chat: ALICE }),
            waMessage({ chat: MALLORY }),
        );

        expect(await senders(value)).toEqual([ALICE]);
        expect(value.errors).toEqual([]);
    });

    it('normalizes a device suffix with the Baileys jid utilities', async () => {
        const value = await started();

        value.sockets.last().deliver(waMessage({ chat: '491701111111:7@s.whatsapp.net' }));

        expect(await senders(value)).toEqual([ALICE]);

        const [run] = await value.runs();

        expect(run?.address).toBe(value.channel.to({ adapter: 'whatsapp', threadId: `whatsapp:${ALICE}` }));
        expect(run?.trigger.invoker).toEqual({
            id: ALICE,
            kind: 'whatsapp',
            permissions: [],
        });
    });

    it('needs an allowed group, an allowed participant and, by default, a mention', async () => {
        const value = await started();
        const socket = value.sockets.last();

        socket.deliver(
            // allowed group, allowed participant, mentioned
            waMessage({
                chat: GROUP,
                participant: ALICE,
                mentions: [BOT_JID],
                id: 'ok',
            }),
            // the LID form of the bot counts as a mention too
            waMessage({
                chat: GROUP,
                participant: ALICE,
                mentions: [BOT_LID],
                id: 'ok-lid',
            }),
            // not mentioned
            waMessage({
                chat: GROUP,
                participant: ALICE,
                id: 'quiet',
            }),
            // participant not allowed
            waMessage({
                chat: GROUP,
                participant: MALLORY,
                mentions: [BOT_JID],
                id: 'stranger',
            }),
            // group not allowed
            waMessage({
                chat: '120363000000000002@g.us',
                participant: ALICE,
                mentions: [BOT_JID],
                id: 'elsewhere',
            }),
            // no participant: the group jid is never taken for the sender
            waMessage({
                chat: GROUP,
                mentions: [BOT_JID],
                id: 'anonymous',
            }),
        );

        await settle();

        const runs = await value.runs();

        expect(runs.map((run) => (run.trigger.payload as { message: { id: string } }).message.id).sort()).toEqual(['ok', 'ok-lid']);
        expect(runs.every((run) => (run.trigger.payload as { event: string }).event === 'mention')).toBe(true);
    });

    it('takes group messages without a mention when requireGroupMention is false', async () => {
        const value = await started({
            patch: {
                policy: {
                    senders: [ALICE],
                    groups: [GROUP],
                    requireGroupMention: false,
                },
            },
            agents: (channel) => [defineAgent({
                name: 'assistant',
                model: textModel(),
                instructions: 'Answer.',
                channels: [channel.on({ events: ['direct', 'mention', 'message'] })],
            })],
        });

        value.sockets.last().deliver(waMessage({ chat: GROUP, participant: ALICE }));

        expect(await senders(value)).toEqual([ALICE]);
    });

    it('denies a LID participant without an authenticated mapping, never borrowing another identity', async () => {
        const value = await started();
        const socket = value.sockets.last();

        socket.deliver(waMessage({
            chat: GROUP,
            participant: '111111111111@lid',
            // a display name that looks like an allowed sender decides nothing
            pushName: ALICE,
            mentions: [BOT_JID],
            id: 'unmapped',
        }));

        expect(await senders(value)).toEqual([]);

        // the server's participant alternative resolves it
        socket.deliver(waMessage({
            chat: GROUP,
            participant: '111111111111@lid',
            participantAlt: ALICE,
            mentions: [BOT_JID],
            id: 'alt',
        }));

        expect(await senders(value)).toEqual([ALICE]);

        // so does the socket's LID mapping store
        socket.lids.set('222222222222@lid', ALICE);
        socket.deliver(waMessage({ chat: '222222222222@lid', id: 'mapped' }));

        expect(await senders(value)).toEqual([ALICE, ALICE]);
        expect(value.errors).toEqual([]);
    });

    it('denies a message whose invoker is unknown', async () => {
        const value = await started({ patch: { resolveInvoker: () => undefined } });

        value.sockets.last().deliver(waMessage({ chat: ALICE }));

        expect(await senders(value)).toEqual([]);
    });

    it('needs an explicit identity decision under the open policy', async () => {
        const decided: WhatsAppIdentity[] = [];
        const value = await started({
            patch: {
                policy: { open: true },
                resolveInvoker: (identity) => {
                    decided.push(identity);

                    // a non-privileged invoker for the stranger, nobody else
                    return identity.sender === MALLORY ?
                        {
                            id: identity.sender,
                            kind: 'whatsapp-guest',
                            permissions: [],
                        } :
                        undefined;
                },
            },
        });

        value.sockets.last().deliver(
            waMessage({ chat: MALLORY }),
            waMessage({ chat: '491703333333@s.whatsapp.net' }),
        );

        expect(await senders(value)).toEqual([MALLORY]);
        expect(decided.map((identity) => identity.sender).sort()).toEqual([MALLORY, '491703333333@s.whatsapp.net'].sort());
        expect(decided[0]).toEqual(expect.objectContaining({
            account: 'support',
            group: false,
            mentioned: false,
        }));
    });

    it('never hands a group message without participant to resolveInvoker, also under the open policy', async () => {
        const decided: WhatsAppIdentity[] = [];
        const value = await started({
            patch: {
                policy: {
                    open: true,
                    groups: [GROUP],
                    requireGroupMention: false,
                },
                resolveInvoker: (identity) => {
                    decided.push(identity);

                    return {
                        id: identity.sender,
                        kind: 'whatsapp-guest',
                        permissions: [],
                    };
                },
            },
        });

        value.sockets.last().deliver(
            waMessage({ chat: GROUP, id: 'anonymous' }),
            // the control: the same message with a participant is decided on
            waMessage({
                chat: GROUP,
                participant: MALLORY,
                id: 'named',
            }),
        );
        await settle();

        expect(decided.map((identity) => identity.sender)).toEqual([MALLORY]);
        expect(decided.map((identity) => identity.chat)).toEqual([GROUP]);
    });

    it('ignores the bot\'s own messages', async () => {
        const decided: WhatsAppIdentity[] = [];
        const value = await started({
            patch: {
                resolveInvoker: (identity) => {
                    decided.push(identity);

                    return {
                        id: identity.sender,
                        kind: 'whatsapp',
                        permissions: [],
                    };
                },
            },
        });

        value.sockets.last().deliver(waMessage({ chat: ALICE, fromMe: true }));

        expect(await senders(value)).toEqual([]);
        expect(decided).toEqual([]);
        expect(value.errors).toEqual([]);
    });

    it('refuses an allowed message with media, reporting no text of it', async () => {
        const value = await started();

        value.sockets.last().deliver(waMessage({
            chat: ALICE,
            image: true,
            text: 'private caption',
        }));

        expect(await senders(value)).toEqual([]);
        expect(value.errors).toHaveLength(1);
        expect(String((value.errors[0] as Error).message)).toMatch(/attachments are not supported/);
        expect(JSON.stringify(value.errors[0], Object.getOwnPropertyNames(value.errors[0]))).not.toContain('private caption');
    });

    it('hands pairing material to onPairing once, never to onError or a log', async () => {
        const logged: unknown[] = [];
        const record = (...args: unknown[]) => {
            logged.push(args);
        };
        const value = await started({
            patch: {
                logger: {
                    child: () => undefined as never,
                    debug: record,
                    info: record,
                    warn: record,
                    error: record,
                },
            },
        });
        const socket = value.sockets.last();

        socket.emit('connection.update', { qr: 'SECRET-QR-REF' });

        expect(value.pairings).toEqual([{ qr: 'SECRET-QR-REF' }]);
        expect(JSON.stringify(value.errors)).not.toContain('SECRET-QR-REF');
        expect(JSON.stringify(logged)).not.toContain('SECRET-QR-REF');

        // the logger Baileys gets drops everything
        const baileysLogger = socket.config.logger!;

        baileysLogger.error({ qr: 'SECRET-QR-REF' }, 'pairing');
        baileysLogger.child({}).info('SECRET-QR-REF');
        expect(JSON.stringify(logged)).not.toContain('SECRET-QR-REF');
    });
});

describe('WhatsApp conversation target', () => {
    it('maps an identity to the account alias, the chat jid and its audience', () => {
        expect(toConversationTarget({
            account: 'support',
            chat: ALICE,
            sender: ALICE,
            group: false,
            mentioned: false,
        }, 'hi')).toEqual({
            account: 'support',
            chat: ALICE,
            audience: `direct:${ALICE}`,
            text: 'hi',
        });

        expect(toConversationTarget({
            account: 'support',
            chat: GROUP,
            sender: ALICE,
            group: true,
            mentioned: true,
        }, 'hi all')).toEqual({
            account: 'support',
            chat: GROUP,
            audience: `group:${GROUP}`,
            text: 'hi all',
        });
    });

    it('binds a conversation agent through the mapped target, one memory per group', async () => {
        const value = await started({
            agents: (channel) => [defineAgent({
                name: 'assistant',
                model: textModel(),
                instructions: 'Answer.',
                conversation: true,
                channels: [channel.on()],
            })],
        });

        value.sockets.last().deliver(
            waMessage({ chat: '491701111111:4@s.whatsapp.net', text: 'direct' }),
            waMessage({
                chat: GROUP,
                participant: ALICE,
                mentions: [BOT_JID],
                text: 'group',
            }),
            // unresolved: no target, no run
            waMessage({
                chat: GROUP,
                participant: '333333333333@lid',
                mentions: [BOT_JID],
                text: 'nobody',
            }),
        );

        await settle();

        expect(value.access.filter((item) => item.operation === 'dispatch').map((item) => ({
            account: item.identity.account,
            chat: item.identity.chat,
            audience: item.identity.audience,
        })).sort((a, b) => a.audience.localeCompare(b.audience))).toEqual([
            {
                account: 'support',
                chat: ALICE,
                audience: `direct:${ALICE}`,
            },
            {
                account: 'support',
                chat: GROUP,
                audience: `group:${GROUP}`,
            },
        ]);
        expect(await value.runs()).toHaveLength(2);
    });
});
