/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ModelMessage } from 'ai';
import type { ConversationOperation, ConversationTurnKind } from './constants.ts';
import type { IClock } from '../clock/index.ts';
import type { Invoker } from '../trigger/types.ts';

/**
 * Who a conversation is with, as the trusted channel names it: the memory key, the
 * channel, an account alias on that channel, the chat and an explicit
 * audience. Each field is a non-blank string of at most
 * CONVERSATION_FIELD_MAX_LENGTH UTF-16 code units without control characters
 * or lone surrogates. The scope id is the sha256 of its canonical JSON.
 */
export type ConversationIdentity = {
    /** Stable memory key from the agent configuration; defaults to its name. */
    agent: string;
    channel: string;
    account: string;
    chat: string;
    audience: string;
};

/**
 * One generation of a conversation: `id` the identity's digest, `generation`
 * advanced by a reset or delete, so queued work of an older generation never
 * reaches the new one.
 */
export type ConversationScope = {
    id: string;
    generation: number;
    identity: ConversationIdentity;
};

/** What a channel hands to the trusted intake: the identity fields it owns plus the user's text. */
export type ConversationTarget = {
    account: string;
    chat: string;
    audience: string;
    /** Accepted user text used for the current model message and future transcript recall. */
    text: string;
};

/** A run's conversation (`Run.conversation`): set by the trusted intake only, never by a dispatch envelope. */
export type ConversationBinding = {
    scope: ConversationScope;
    text: string;
};

/**
 * Byte and count bounds of a conversation; every value a positive safe integer
 * at most its CONVERSATION_LIMITS_MAX entry. These are UTF-8 byte bounds, not
 * model token estimates.
 */
export type ConversationLimits = {
    /** Prior transcript items recalled per turn. */
    maxItems?: number;
    /** UTF-8 bytes of recalled transcript per turn. */
    maxHistoryBytes?: number;
    /** UTF-8 bytes of notes recalled per turn. */
    maxNotesBytes?: number;
    /** UTF-8 bytes of one item or note. */
    maxItemBytes?: number;
    /** How long transcript items are kept. */
    retentionMs?: number;
    /** Transcript items kept per generation. */
    maxStoredItems?: number;
};

/** ConversationLimits with every default applied (resolved once, when the capability is built). */
export type ResolvedConversationLimits = {
    readonly [K in keyof ConversationLimits]-?: number;
};

export type ConversationOperationLiteral = `${ConversationOperation}`;

/** The question an authorizer answers before a conversation is dispatched, recalled or its notes touched. */
export type ConversationAccess = {
    /** Actual agent name, independently of the stable identity.agent memory key. */
    agent: string;
    operation: ConversationOperationLiteral;
    identity: ConversationIdentity;
    invoker?: Invoker;
};

/** The engine's conversation capability (`EngineOptions.conversations`). */
export type ConversationOptions = {
    store: IConversationStore;
    authorize: (access: ConversationAccess) => boolean | Promise<boolean>;
    limits?: ConversationLimits;
};

/**
 * One transcript record: an accepted user message (`sent` = accepted input),
 * or an assistant emit to the source address (`sent` once the channel's `out`
 * resolved, `unknown` when that is uncertain). Only `sent` items are recalled.
 */
export type ConversationItem = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    runId: string;
    createdAt: Date;
    status: 'pending' | 'sent' | 'unknown';
    effectKey?: string;
    target?: { channel: string; address: string };
};

/** Where a note operation came from: the run, tool call and model step. */
export type ConversationNoteSource = {
    runId: string;
    toolCallId: string;
    stepIndex: number;
};

export type ConversationNote = {
    key: string;
    text: string;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date;
    source: ConversationNoteSource;
};

/**
 * One durable note change. `id` identifies the operation (derived from its
 * source and the operation's ordinal within the tool call), `inputHash` the
 * input it was applied with, so a replay with the same id is answered from
 * the record and never applied twice.
 */
export type ConversationNoteOperation = {
    id: string;
    inputHash: string;
    source: ConversationNoteSource;
    kind: 'set';
    key: string;
    text: string;
    expiresAt?: Date;
} | {
    id: string;
    inputHash: string;
    source: ConversationNoteSource;
    kind: 'remove';
    key: string;
};

/** The outcome of a note operation: metadata only, never the note's text. */
export type ConversationNoteResult = {
    kind: 'set';
    key: string;
    updatedAt: Date;
} | {
    kind: 'remove';
    key: string;
    removed: boolean;
};

/**
 * What a run recalled, stored before its first model step: the rendered
 * messages, the items and notes they came from, and how many items did not fit.
 */
export type ConversationSnapshot = {
    scope: ConversationScope;
    runId: string;
    messages: ModelMessage[];
    itemIds: string[];
    noteKeys: string[];
    createdAt: Date;
    omitted: number;
};

export type BeginTurnResult = {
    kind: `${ConversationTurnKind.READY}`;
    snapshot: ConversationSnapshot;
} | {
    kind: `${ConversationTurnKind.BUSY}`;
    runId: string;
} | {
    kind: `${ConversationTurnKind.STALE}`;
};

export type MemoryConversationStoreOptions = {
    /** Every date and expiry decision; default systemClock. */
    clock?: IClock;
};

/**
 * Conversation persistence, separate from (and optional beside) IStore.
 * Dates come from the store's IClock; values are copied in and out.
 */
export interface IConversationStore {
    /** The identity's current scope, created at generation 0 when missing; never revives a deleted generation. */
    resolve(identity: ConversationIdentity): Promise<ConversationScope>;
    /** The identity's current scope, or undefined; read only. */
    get(identity: ConversationIdentity): Promise<ConversationScope | undefined>;
    /** Admit only a nonterminal run; retries reuse its snapshot while it owns the turn. */
    beginTurn(
        scope: ConversationScope,
        runId: string,
        text: string,
        limits: ResolvedConversationLimits,
    ): Promise<BeginTurnResult>;
    /** Read-only owner lookup for terminal repair, never reserves a turn. */
    activeRun(scope: ConversationScope): Promise<string | undefined>;
    /** Terminal settlement only: clears the owner and snapshot. Never resume this run afterward. */
    endTurn(scope: ConversationScope, runId: string, confirmedEmitIds: string[]): Promise<void>;
    prepareEmit(scope: ConversationScope, item: ConversationItem): Promise<void>;
    confirmEmit(scope: ConversationScope, itemId: string): Promise<void>;
    pendingEmits(scope: ConversationScope, runId: string): Promise<ConversationItem[]>;
    listItems(
        scope: ConversationScope,
        query: { limit: number; offset: number },
    ): Promise<{ data: ConversationItem[]; total: number }>;
    listNotes(
        scope: ConversationScope,
        query: { limit: number; offset: number },
    ): Promise<{ data: ConversationNote[]; total: number }>;
    getNote(scope: ConversationScope, key: string): Promise<ConversationNote | undefined>;
    applyNote(scope: ConversationScope, operation: ConversationNoteOperation): Promise<ConversationNoteResult>;
    reset(identity: ConversationIdentity, options: { keepNotes: boolean }): Promise<ConversationScope>;
    delete(identity: ConversationIdentity): Promise<void>;
    prune(
        limits: ResolvedConversationLimits,
        options?: { isSettled?: (runId: string) => Promise<boolean> },
    ): Promise<void>;
}

/** Privileged in-process inspection; audit runs/checkpoints are separate retained copies. */
export type ConversationInspection = {
    scope: ConversationScope;
    items: { data: ConversationItem[]; total: number };
    notes: { data: ConversationNote[]; total: number };
};
