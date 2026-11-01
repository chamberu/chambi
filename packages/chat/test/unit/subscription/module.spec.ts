/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { Chat } from 'chat';
import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import {
    CHAT_ADDRESS_PREFIX,
    chat,
    chatChannel,
    createChatIngressAdapter,
} from '@chamvi/chat';
import type { ChatPayload } from '@chamvi/chat';
import { decodeChatAddress } from '../../../src/channel/helpers.ts';
import { matchesChatSubscription } from '../../../src/subscription/helpers.ts';
import { createFakeAdapter } from '../../utils/adapter.ts';
import { createMemoryState, createRecordingLogger } from '../../utils/chat.ts';

function payload(patch: Partial<ChatPayload> = {}, id = 'm-1'): ChatPayload {
    return {
        adapter: 'fake',
        event: 'direct',
        threadId: 'fake:chat-1',
        channelId: 'fake:chat-1',
        message: {
            id,
            text: 'hello',
            author: { id: 'user-1' },
        },
        ...patch,
    };
}

function channelOf(...names: string[]) {
    const adapters = names.map((name) => createChatIngressAdapter(createFakeAdapter(name)));

    return chatChannel({
        chat: new Chat({
            userName: 'chamvi',
            adapters: Object.fromEntries(adapters.map((adapter) => [adapter.name, adapter])),
            state: createMemoryState(),
            logger: createRecordingLogger(),
            concurrency: 'concurrent',
        }),
        adapters,
        allowMessage: () => true,
        name: 'support',
    });
}

describe('chat.on()', () => {
    it('defaults to direct messages and mentions of the chat channel', () => {
        const subscription = chat.on();

        expect(subscription.channel).toBe('chat');
        expect(subscription.id).toBe('chat:direct,mention');
        expect(subscription.options).toEqual({ events: ['direct', 'mention'] });
        expect(matchesChatSubscription(subscription, payload())).toBe(true);
        expect(matchesChatSubscription(subscription, payload({ event: 'mention' }))).toBe(true);
        // a regular group message needs the event named
        expect(matchesChatSubscription(subscription, payload({ event: 'message' }))).toBe(false);
    });

    it('matches adapter, events and filter', () => {
        const subscription = chat.on({
            adapter: 'fake',
            events: ['message', 'message'],
            filter: (input) => input.message.text.startsWith('!'),
            concurrencyMaxRuns: 2,
        });

        expect(subscription.id).toBe('chat:fake:message');
        expect(subscription.concurrencyMaxRuns).toBe(2);
        expect(subscription.options.events).toEqual(['message']);
        expect(matchesChatSubscription(subscription, payload({
            event: 'message',
            message: {
                id: 'm-1',
                text: '!help',
                author: { id: 'u' },
            },
        }))).toBe(true);
        expect(matchesChatSubscription(subscription, payload({ event: 'message' }))).toBe(false);
        expect(matchesChatSubscription(subscription, payload({
            adapter: 'other',
            event: 'message',
            message: {
                id: 'm-1',
                text: '!help',
                author: { id: 'u' },
            },
        }))).toBe(false);
    });

    it('hashes bounded keys per chat and per message', () => {
        const subscription = chat.on();
        const first = subscription.idempotencyKey?.(payload());
        const concurrency = subscription.concurrencyKey?.(payload());

        expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(concurrency).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(subscription.idempotencyKey?.(payload())).toBe(first);
        expect(subscription.idempotencyKey?.(payload({}, 'm-2'))).not.toBe(first);
        // one message id of another author is another message
        expect(subscription.idempotencyKey?.(payload({
            message: {
                id: 'm-1',
                text: 'hello',
                author: { id: 'user-2' },
            },
        }))).not.toBe(first);
        expect(subscription.concurrencyKey?.(payload({}, 'm-2'))).toBe(concurrency);
        expect(subscription.concurrencyKey?.(payload({ threadId: 'fake:chat-2' }))).not.toBe(concurrency);
        // another channel's keys differ
        expect(channelOf('fake').on().idempotencyKey?.(payload())).not.toBe(first);
    });

    it('refuses invalid options', () => {
        expect(() => chat.on({ events: [] })).toThrow(InvalidAgentDefinitionError);
        expect(() => chat.on({ events: ['group' as 'message'] })).toThrow(/must be one of/);
        expect(() => chat.on({ adapter: '' })).toThrow(/adapter/);
        expect(() => chat.on({ id: '' })).toThrow(/id/);
        expect(() => chat.on({ filter: 'x' as unknown as () => boolean })).toThrow(/filter/);
        expect(() => chat.on({ concurrencyMaxRuns: 0 })).toThrow(InvalidAgentDefinitionError);
        expect(() => chat.on('x' as never)).toThrow(/options/);
    });

    it('a channel binds its name and checks its adapters', () => {
        const channel = channelOf('fake');

        expect(channel.on().channel).toBe('support');
        expect(channel.on({ adapter: 'fake' }).options.adapter).toBe('fake');
        expect(() => channel.on({ adapter: 'slack' })).toThrow(/no adapter "slack"/);
    });
});

describe('chat addresses', () => {
    it('address_round_trip_and_foreign_adapter_refused', () => {
        const target = { adapter: 'fake', threadId: 'fake:120363@g.us:ünïcødé' };
        const address = chat.to(target);

        expect(address.startsWith(CHAT_ADDRESS_PREFIX)).toBe(true);
        expect(decodeChatAddress(address)).toEqual(target);
        expect(decodeChatAddress(address, ['fake'])).toEqual(target);

        const channel = channelOf('fake', 'slack');

        expect(channel.to(target)).toBe(address);
        expect(() => channel.to({ adapter: 'teams', threadId: 'x' })).toThrow(ValidationError);
        expect(() => decodeChatAddress(chat.to({ adapter: 'teams', threadId: 'x' }), ['fake', 'slack']))
            .toThrow(/no adapter "teams"/);
    });

    it('refuses malformed addresses and parts', () => {
        const canonical = chat.to({ adapter: 'fake', threadId: 't' });
        const json = (value: unknown) => CHAT_ADDRESS_PREFIX + Buffer.from(JSON.stringify(value)).toString('base64url');

        for (const address of [
            'fake:t',
            'chat:',
            'chat:***',
            `${canonical}=`,
            json(['fake']),
            json(['fake', '']),
            json(['fake', 't', 'x']),
            json({ adapter: 'fake' }),
            CHAT_ADDRESS_PREFIX + Buffer.from('[ "fake", "t" ]').toString('base64url'),
            CHAT_ADDRESS_PREFIX + Buffer.from([0xFF, 0xFE]).toString('base64url'),
        ]) {
            expect(() => decodeChatAddress(address), address).toThrow(ValidationError);
        }

        expect(() => chat.to({ adapter: 'fake', threadId: 'a\0b' })).toThrow(ValidationError);
        expect(() => chat.to({ adapter: '', threadId: 't' })).toThrow(ValidationError);
        expect(() => chat.to(null as never)).toThrow(ValidationError);
    });

    it('refuses an address above 255 characters instead of hashing it', () => {
        expect(() => chat.to({ adapter: 'fake', threadId: 'x'.repeat(200) })).toThrow(/exceeds 255/);
        expect(chat.to({ adapter: 'fake', threadId: 'x'.repeat(150) }).length).toBeLessThanOrEqual(255);
    });
});
