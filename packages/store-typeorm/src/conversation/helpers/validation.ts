/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import {
    CONVERSATION_LIMITS_MAX,
    CONVERSATION_NOTE_KEY_MAX_LENGTH,
    CONVERSATION_NOTE_TEXT_MAX_BYTES,
    ValidationError,
} from '@chamvi/core';
import type { ConversationItem, ConversationNoteOperation } from '@chamvi/core';
import { FORBIDDEN_FIELD_CHARACTER, LONE_SURROGATE } from './constants.ts';

/**
 * Refuses conversation text that is no non-empty string, holds NUL or a lone
 * surrogate, or exceeds `maxBytes` UTF-8 bytes. The ValidationError never
 * echoes the text.
 */
export function assertConversationText(text: unknown, maxBytes: number): asserts text is string {
    if (typeof text !== 'string' || text.length === 0) {
        throw new ValidationError('The conversation text must be a non-empty string.');
    }
    if (text.includes('\u0000') || LONE_SURROGATE.test(text)) {
        throw new ValidationError('The conversation text must be well-formed Unicode without NUL.');
    }
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new ValidationError(`The conversation text must be at most ${maxBytes} UTF-8 bytes.`);
    }
}

export function assertRunId(runId: unknown): asserts runId is string {
    if (typeof runId !== 'string' || runId.length === 0 || runId.includes('\u0000') || LONE_SURROGATE.test(runId)) {
        throw new ValidationError('The run id must be a non-empty, well-formed Unicode string without NUL.');
    }
}

export function assertPage(query: unknown): asserts query is { limit: number; offset: number } {
    if (
        !isObject(query) ||
        !Number.isSafeInteger(query.limit) || (query.limit as number) < 1 ||
        !Number.isSafeInteger(query.offset) || (query.offset as number) < 0
    ) {
        throw new ValidationError('The page needs a positive integer limit and a non-negative integer offset.');
    }
}

function isShortString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}

/** Refuses an emit that is no pending assistant item of well-formed strings. */
export function assertEmitItem(item: unknown): asserts item is ConversationItem {
    if (!isObject(item)) {
        throw new ValidationError('The conversation item must be an object.');
    }
    if (!isShortString(item.id) || !isShortString(item.runId)) {
        throw new ValidationError('The conversation item needs an id and a run id.');
    }
    if (item.role !== 'assistant' || item.status !== 'pending') {
        throw new ValidationError('A prepared conversation item must be a pending assistant item.');
    }
    assertConversationText(item.text, CONVERSATION_LIMITS_MAX.maxItemBytes);
    if (item.effectKey !== undefined && !isShortString(item.effectKey)) {
        throw new ValidationError('The conversation item effect key must be a non-empty string.');
    }
    if (item.target !== undefined) {
        const { target } = item;
        if (!isObject(target) || !isShortString(target.channel) || typeof target.address !== 'string' ||
            target.address.includes('\u0000') || LONE_SURROGATE.test(target.address)) {
            throw new ValidationError('The conversation item target needs a channel and an address.');
        }
    }
}

/** The fields a replay is matched on: an id and an input hash. */
export function assertNoteOperationShape(operation: unknown): asserts operation is ConversationNoteOperation {
    if (!isObject(operation)) {
        throw new ValidationError('The note operation must be an object.');
    }
    if (!isShortString(operation.id) || !isShortString(operation.inputHash)) {
        throw new ValidationError('The note operation needs an id and an input hash.');
    }
    const { source } = operation;
    if (
        !isObject(source) ||
        !isShortString(source.runId) ||
        !isShortString(source.toolCallId) ||
        !Number.isSafeInteger(source.stepIndex) || (source.stepIndex as number) < 0
    ) {
        throw new ValidationError('The note operation needs its run, tool call and step.');
    }
    if (operation.kind !== 'set' && operation.kind !== 'remove') {
        throw new ValidationError('The note operation kind must be set or remove.');
    }
}

/** Key, text and expiry of a fresh operation; never echoes a value. */
export function assertNoteOperationContent(operation: ConversationNoteOperation, now: Date): void {
    const { key } = operation;
    if (
        typeof key !== 'string' ||
        key.trim().length === 0 ||
        key.length > CONVERSATION_NOTE_KEY_MAX_LENGTH ||
        FORBIDDEN_FIELD_CHARACTER.test(key)
    ) {
        throw new ValidationError(
            `The note key must be a non-blank string of at most ${CONVERSATION_NOTE_KEY_MAX_LENGTH} ` +
            'characters without control characters.',
        );
    }
    if (operation.kind !== 'set') return;
    assertConversationText(operation.text, CONVERSATION_NOTE_TEXT_MAX_BYTES);
    const { expiresAt } = operation;
    if (expiresAt !== undefined) {
        if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
            throw new ValidationError('The note expiry must be a valid date.');
        }
        if (expiresAt.getTime() <= now.getTime()) {
            throw new ValidationError('The note expiry must lie in the future.');
        }
    }
}
