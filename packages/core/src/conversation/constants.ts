/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ResolvedConversationLimits } from './types.ts';

/** The most UTF-16 code units of one ConversationIdentity field. */
export const CONVERSATION_FIELD_MAX_LENGTH = 255;

/** The limits a conversation gets unless ConversationOptions.limits says otherwise. */
export const DEFAULT_CONVERSATION_LIMITS: ResolvedConversationLimits = Object.freeze({
    maxItems: 20,
    maxHistoryBytes: 32_768,
    maxNotesBytes: 8192,
    maxItemBytes: 16_384,
    /** 30 days. */
    retentionMs: 2_592_000_000,
    maxStoredItems: 1000,
});

/** The most UTF-16 code units of a note key. */
export const CONVERSATION_NOTE_KEY_MAX_LENGTH = 128;

/** The most UTF-8 bytes of a note's text. */
export const CONVERSATION_NOTE_TEXT_MAX_BYTES = 2048;

/** The most live notes one conversation holds. */
export const CONVERSATION_NOTES_MAX = 100;

/** The highest value each ConversationLimits entry may take. */
export const CONVERSATION_LIMITS_MAX: ResolvedConversationLimits = Object.freeze({
    maxItems: 100,
    maxHistoryBytes: 131_072,
    maxNotesBytes: 32_768,
    maxItemBytes: 65_536,
    /** 365 days. */
    retentionMs: 31_536_000_000,
    maxStoredItems: 10_000,
});
