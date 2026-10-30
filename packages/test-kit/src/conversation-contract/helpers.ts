/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    ConversationIdentity,
    ConversationItem,
    ConversationNoteOperation,
    ConversationScope,
    IConversationRepository,
    ResolvedConversationLimits,
} from '@chamvi/core';
import { DEFAULT_CONVERSATION_LIMITS } from '@chamvi/core';
import type { ControllableClock } from '../clock/index.ts';

export const LIMITS: ResolvedConversationLimits = { ...DEFAULT_CONVERSATION_LIMITS };

export function makeIdentity(chat = 'chat-1', overrides: Partial<ConversationIdentity> = {}): ConversationIdentity {
    return {
        agent: 'helper',
        channel: 'openclaw',
        account: 'main',
        chat,
        audience: 'direct',
        ...overrides,
    };
}

export function makeEmit(clock: ControllableClock, runId: string, n: number, text: string): ConversationItem {
    return {
        id: `assistant:${runId}:${n}`,
        role: 'assistant',
        text,
        runId,
        createdAt: clock.now(),
        status: 'pending',
        effectKey: `${runId}:emit:${n}`,
        target: { channel: 'openclaw', address: 'chat-1' },
    };
}

export function makeSet(
    runId: string,
    key: string,
    text: string,
    options: {
        toolCallId?: string;
        stepIndex?: number;
        expiresAt?: Date;
        inputHash?: string
    } = {},
): Extract<ConversationNoteOperation, { kind: 'set' }> {
    const toolCallId = options.toolCallId ?? `call-${key}`;
    const stepIndex = options.stepIndex ?? 0;
    return {
        id: `${runId}:${stepIndex}:${toolCallId}:0`,
        inputHash: options.inputHash ?? `hash:set:${key}:${text}`,
        source: {
            runId,
            toolCallId,
            stepIndex,
        },
        kind: 'set',
        key,
        text,
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    };
}

export function makeRemove(runId: string, key: string, toolCallId = `call-rm-${key}`): ConversationNoteOperation {
    return {
        id: `${runId}:0:${toolCallId}:0`,
        inputHash: `hash:remove:${key}`,
        source: {
            runId,
            toolCallId,
            stepIndex: 0,
        },
        kind: 'remove',
        key,
    };
}

/** One whole turn: begin, the given replies emitted and confirmed, end. */
export async function completeTurn(
    store: IConversationRepository,
    clock: ControllableClock,
    scope: ConversationScope,
    runId: string,
    text: string,
    replies: string[] = [],
    limits: ResolvedConversationLimits = LIMITS,
): Promise<void> {
    const begun = await store.beginTurn(scope, runId, text, limits);
    if (begun.kind !== 'ready') throw new TypeError(`turn ${runId} did not begin (${begun.kind})`);
    const ids: string[] = [];
    for (const [n, reply] of replies.entries()) {
        const item = makeEmit(clock, runId, n, reply);
        await store.prepareEmit(scope, item);
        ids.push(item.id);
    }
    await store.endTurn(scope, runId, ids);
}
