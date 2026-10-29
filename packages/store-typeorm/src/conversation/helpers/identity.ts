/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { isObject } from 'smob';
import { CONVERSATION_FIELD_MAX_LENGTH, ValidationError } from '@chamvi/core';
import type { ConversationIdentity, ConversationScope } from '@chamvi/core';
import { FORBIDDEN_FIELD_CHARACTER } from './constants.ts';

const IDENTITY_FIELDS = ['agent', 'channel', 'account', 'chat', 'audience'] as const;

const SCOPE_ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Refuses an identity whose fields are not non-blank strings of at most
 * CONVERSATION_FIELD_MAX_LENGTH code units without control characters or lone
 * surrogates. The ValidationError names the field, never a value.
 */
export function assertConversationIdentity(identity: unknown): asserts identity is ConversationIdentity {
    if (!isObject(identity)) {
        throw new ValidationError('The conversation identity must be an object.');
    }
    for (const field of IDENTITY_FIELDS) {
        const value = identity[field];
        if (
            typeof value !== 'string' ||
            value.trim().length === 0 ||
            value.length > CONVERSATION_FIELD_MAX_LENGTH ||
            FORBIDDEN_FIELD_CHARACTER.test(value)
        ) {
            throw new ValidationError(
                `The conversation ${field} must be a non-blank string of at most ` +
                `${CONVERSATION_FIELD_MAX_LENGTH} characters without control characters.`,
            );
        }
    }
}

/**
 * The scope id of an identity: the sha256 hex of the canonical JSON of its
 * five fields (sorted keys), so property order and extra properties never
 * change it.
 */
export function identityId(identity: ConversationIdentity): string {
    assertConversationIdentity(identity);
    return createHash('sha256').update(JSON.stringify({
        account: identity.account,
        agent: identity.agent,
        audience: identity.audience,
        channel: identity.channel,
        chat: identity.chat,
    })).digest('hex');
}

/** The concurrency key every run of one conversation generation shares: `conversation:<id>:<generation>`. */
export function conversationConcurrencyKey(scope: ConversationScope): string {
    if (typeof scope.id !== 'string' || !SCOPE_ID_PATTERN.test(scope.id)) {
        throw new ValidationError('The conversation scope id must be a sha256 hex digest.');
    }
    if (!Number.isSafeInteger(scope.generation) || scope.generation < 0) {
        throw new ValidationError('The conversation generation must be a non-negative integer.');
    }
    return `conversation:${scope.id}:${scope.generation}`;
}

/** Refuses a scope whose id is no sha256 hex digest or whose generation is no non-negative integer. */
export function assertConversationScope(scope: unknown): asserts scope is ConversationScope {
    if (!isObject(scope)) {
        throw new ValidationError('The conversation scope must be an object.');
    }
    conversationConcurrencyKey(scope as ConversationScope);
}
