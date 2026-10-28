/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import {
    CONVERSATION_FIELD_MAX_LENGTH,
    CONVERSATION_LIMITS_MAX,
    DEFAULT_CONVERSATION_LIMITS,
    InvalidAgentDefinitionError,
    ValidationError,
} from '@chamvi/core';
import type {
    ChannelDispatchEnvelope,
    Checkpoint,
    ConversationBinding,
    ConversationIdentity,
    DispatchEnvelope,
    Run,
} from '@chamvi/core';
import {
    assertConversationText,
    conversationConcurrencyKey,
    identityId,
    normalizeConversationLimits,
} from '../../../src/conversation/helpers.ts';

const identity: ConversationIdentity = {
    agent: 'assistant',
    channel: 'openclaw',
    account: 'acct-1',
    chat: 'chat-42',
    audience: 'owner',
};

function messageOf(fn: () => unknown): string {
    try {
        fn();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error('expected a throw');
}

describe('conversation scope', () => {
    it('defaults_and_hard_limits', () => {
        const defaults = {
            maxItems: 20,
            maxHistoryBytes: 32_768,
            maxNotesBytes: 8192,
            maxItemBytes: 16_384,
            retentionMs: 2_592_000_000,
            maxStoredItems: 1000,
        };
        expect(normalizeConversationLimits()).toEqual(defaults);
        expect(normalizeConversationLimits({})).toEqual(defaults);
        expect(DEFAULT_CONVERSATION_LIMITS).toEqual(defaults);
        expect(CONVERSATION_LIMITS_MAX).toEqual({
            maxItems: 100,
            maxHistoryBytes: 131_072,
            maxNotesBytes: 32_768,
            maxItemBytes: 65_536,
            retentionMs: 31_536_000_000,
            maxStoredItems: 10_000,
        });

        // a fresh object per call, never the shared default
        const resolved = normalizeConversationLimits();
        expect(resolved).not.toBe(DEFAULT_CONVERSATION_LIMITS);

        expect(normalizeConversationLimits({ maxItems: 5, retentionMs: 1000 })).toEqual({
            ...defaults,
            maxItems: 5,
            retentionMs: 1000,
        });
        expect(normalizeConversationLimits({ ...CONVERSATION_LIMITS_MAX })).toEqual(CONVERSATION_LIMITS_MAX);

        for (const [key, max] of Object.entries(CONVERSATION_LIMITS_MAX)) {
            for (const value of [max + 1, 0, -1, 1.5, NaN, Infinity, '5', null, true]) {
                expect(() => normalizeConversationLimits({ [key]: value } as never), `${key}=${String(value)}`)
                    .toThrow(InvalidAgentDefinitionError);
            }
        }
        expect(() => normalizeConversationLimits('x' as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => normalizeConversationLimits([] as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => normalizeConversationLimits({ maxitems: 5 } as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('scope_changes_each_identity_component', () => {
        const id = identityId(identity);
        expect(id).toMatch(/^[0-9a-f]{64}$/);

        // same canonical identity, other property insertion order
        const reordered: ConversationIdentity = {
            audience: 'owner',
            chat: 'chat-42',
            account: 'acct-1',
            channel: 'openclaw',
            agent: 'assistant',
        };
        expect(identityId(reordered)).toBe(id);
        expect(id).toBe(createHash('sha256').update(JSON.stringify({
            account: 'acct-1',
            agent: 'assistant',
            audience: 'owner',
            channel: 'openclaw',
            chat: 'chat-42',
        })).digest('hex'));

        // a stray extra property never changes the scope
        expect(identityId({ ...identity, extra: 'x' } as ConversationIdentity)).toBe(id);

        const seen = new Set([id]);
        for (const key of Object.keys(identity) as (keyof ConversationIdentity)[]) {
            const other = identityId({ ...identity, [key]: `${identity[key]}x` });
            expect(seen.has(other), key).toBe(false);
            seen.add(other);
        }

        expect(conversationConcurrencyKey({
            id,
            generation: 3,
            identity,
        })).toBe(`conversation:${id}:3`);
        expect(() => conversationConcurrencyKey({
            id,
            generation: -1,
            identity,
        })).toThrow(ValidationError);
        expect(() => conversationConcurrencyKey({
            id,
            generation: 1.5,
            identity,
        })).toThrow(ValidationError);
        expect(() => conversationConcurrencyKey({
            id: 'nope',
            generation: 0,
            identity,
        })).toThrow(ValidationError);
    });

    it('control_or_overlong_id_rejected', () => {
        const secret = 'secret-chat';
        const invalid = [
            '',
            ' '.repeat(3),
            `${secret}\u0000`,
            `${secret}\n`,
            `${secret}\u0007`,
            `${secret}\u007f`,
            `${secret}\u0085`,
            `${secret}\ud800`,
            `\udc00${secret}`,
            'a'.repeat(CONVERSATION_FIELD_MAX_LENGTH + 1),
        ];
        for (const key of Object.keys(identity) as (keyof ConversationIdentity)[]) {
            for (const value of invalid) {
                const message = messageOf(() => identityId({ ...identity, [key]: value }));
                expect(() => identityId({ ...identity, [key]: value })).toThrow(ValidationError);
                expect(message).toContain(key);
                expect(message).not.toContain(secret);
                expect(message).not.toContain('assistant');
                expect(message).not.toContain('chat-42');
            }
            expect(() => identityId({ ...identity, [key]: 42 } as never)).toThrow(ValidationError);
            expect(() => identityId({ ...identity, [key]: undefined } as never)).toThrow(ValidationError);
        }
        expect(() => identityId(undefined as never)).toThrow(ValidationError);
        expect(() => identityId([] as never)).toThrow(ValidationError);

        // 255 UTF-16 code units pass, also a well-formed astral pair
        expect(() => identityId({ ...identity, chat: 'a'.repeat(CONVERSATION_FIELD_MAX_LENGTH) })).not.toThrow();
        expect(() => identityId({ ...identity, chat: 'x\u{1F600}' })).not.toThrow();
        expect(() => identityId({ ...identity, chat: '\u{1F600}'.repeat(128) })).toThrow(ValidationError);
    });

    it('utf8_bytes_not_js_length', () => {
        // 'é' is one UTF-16 unit, two UTF-8 bytes
        const twoByte = 'é'.repeat(10);
        expect(twoByte.length).toBe(10);
        expect(() => assertConversationText(twoByte, 20)).not.toThrow();
        expect(() => assertConversationText(twoByte, 19)).toThrow(ValidationError);

        // an astral character: two UTF-16 units, four UTF-8 bytes
        expect(() => assertConversationText('\u{1F600}', 4)).not.toThrow();
        expect(() => assertConversationText('\u{1F600}', 3)).toThrow(ValidationError);

        // newlines and tabs are message text, NUL and lone surrogates are not
        expect(() => assertConversationText('line 1\nline\t2', 100)).not.toThrow();
        const secret = 'private words';
        for (const text of [`${secret}\u0000`, `${secret}\ud800`, '', 42, undefined]) {
            expect(() => assertConversationText(text, 100)).toThrow(ValidationError);
            expect(messageOf(() => assertConversationText(text, 100))).not.toContain(secret);
        }
        expect(messageOf(() => assertConversationText(`${secret}!`.repeat(10), 20))).not.toContain(secret);
    });

    it('ordinary_dispatch_type_has_no_binding', () => {
        expectTypeOf<DispatchEnvelope>().not.toHaveProperty('conversation');
        expectTypeOf<ChannelDispatchEnvelope>().not.toHaveProperty('conversation');
        expectTypeOf<Run>().toHaveProperty('conversation').toEqualTypeOf<ConversationBinding | undefined>();
        expectTypeOf<Checkpoint>().toHaveProperty('conversation')
            .toEqualTypeOf<{
                scopeId: string;
                generation: number;
                snapshotRunId: string
            } | undefined>();
    });
});
