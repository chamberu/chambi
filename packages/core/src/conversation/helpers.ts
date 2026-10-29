/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import { CONVERSATION_LIMITS_MAX, DEFAULT_CONVERSATION_LIMITS } from './constants.ts';
import { assertConversationScope } from './persistence/module.ts';
import type {
    ConversationItem,
    ConversationLimits,
    ConversationNote,
    ConversationScope,
    ResolvedConversationLimits,
} from './types.ts';

const LIMIT_KEYS = Object.keys(DEFAULT_CONVERSATION_LIMITS) as (keyof ResolvedConversationLimits)[];

/**
 * The limits with every default applied; a value that is no positive safe
 * integer at most its CONVERSATION_LIMITS_MAX entry, or an unknown key, is an
 * InvalidAgentDefinitionError naming the key.
 */
export function normalizeConversationLimits(input?: ConversationLimits): ResolvedConversationLimits {
    if (input === undefined) return { ...DEFAULT_CONVERSATION_LIMITS };
    if (!isObject(input)) {
        throw new InvalidAgentDefinitionError('The conversation limits must be an object.');
    }

    for (const key of Object.keys(input)) {
        if (!(LIMIT_KEYS as string[]).includes(key)) {
            throw new InvalidAgentDefinitionError(`The conversation limits have an unknown key "${key}".`);
        }
    }

    const out = { ...DEFAULT_CONVERSATION_LIMITS } as Record<keyof ResolvedConversationLimits, number>;
    for (const key of LIMIT_KEYS) {
        const value: unknown = input[key];
        if (value === undefined) continue;
        const max = CONVERSATION_LIMITS_MAX[key];
        if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
            throw new InvalidAgentDefinitionError(
                `The conversation limit ${key} must be an integer from 1 to ${max}.`,
            );
        }
        out[key] = value as number;
    }
    return out;
}

/** The concurrency key every run of one conversation generation shares: `conversation:<id>:<generation>`. */
export function conversationConcurrencyKey(scope: ConversationScope): string {
    assertConversationScope(scope);
    return `conversation:${scope.id}:${scope.generation}`;
}

/** A record created at `createdAt` with `ttlMs` is expired at exactly createdAt + ttlMs. */
export function isExpired(createdAt: Date, ttlMs: number, now: Date): boolean {
    return createdAt.getTime() + ttlMs <= now.getTime();
}

/** A note with expiresAt is gone from that instant on. */
export function isNoteActive(note: ConversationNote, now: Date): boolean {
    return note.expiresAt === undefined || note.expiresAt.getTime() > now.getTime();
}

/** A persisted emit receipt must describe the recorded source target, not just share a custom key. */
export function matchesEmitReceipt(result: unknown, target: ConversationItem['target']): boolean {
    return target !== undefined && isObject(result) && result.channel === target.channel && result.address === target.address;
}
