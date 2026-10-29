/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { systemClock } from '../clock/index.ts';
import type { IClock } from '../clock/index.ts';
import { InvalidRunStateError, ValidationError } from '../errors/index.ts';
import { compareCodePoints, copy } from '../store/memory/helpers.ts';
import { CONVERSATION_LIMITS_MAX, CONVERSATION_NOTES_MAX } from './constants.ts';
import {
    assertConversationIdentity,
    assertConversationScope,
    assertConversationText,
    assertEmitItem,
    assertNoteOperationContent,
    assertNoteOperationShape,
    assertPage,
    assertRunId,
    buildSnapshotContent,
    identityId,
    isSameEmit,
    userItemId,
} from './persistence/module.ts';
import { isExpired, isNoteActive } from './helpers.ts';
import type {
    BeginTurnResult,
    ConversationIdentity,
    ConversationItem,
    ConversationNote,
    ConversationNoteOperation,
    ConversationNoteResult,
    ConversationScope,
    ConversationSnapshot,
    IConversationStore,
    MemoryConversationStoreOptions,
    ResolvedConversationLimits,
} from './types.ts';

type StoredItem = {
    generation: number;
    item: ConversationItem;
};

/** A note operation's tombstone: metadata only, never the note's text. */
type StoredOperation = {
    runId: string;
    inputHash: string;
    result: ConversationNoteResult;
    createdAt: Date;
};

type ScopeRecord = {
    identity: ConversationIdentity;
    generation: number;
    activeRunId?: string;
    /** Every generation's items, in insertion order. */
    items: StoredItem[];
    /** The current generation's notes. */
    notes: Map<string, ConversationNote>;
    /** Frozen context for the active owner only. */
    snapshot?: ConversationSnapshot;
    /** Operation tombstones by `<generation>:<operation id>`. */
    operations: Map<string, StoredOperation>;
};

function staleError(): InvalidRunStateError {
    return new InvalidRunStateError('The conversation scope is stale: it was reset or deleted.');
}

function ownerError(): InvalidRunStateError {
    return new InvalidRunStateError('The run does not hold the conversation turn.');
}

/**
 * In-memory IConversationStore. Methods never await between a check and the
 * matching write, which makes every operation atomic; values are structured
 * clones in and out, and every date and expiry comes from the IClock.
 */
export class MemoryConversationStore implements IConversationStore {
    protected clock: IClock;

    protected records = new Map<string, ScopeRecord>();

    constructor(options: MemoryConversationStoreOptions = {}) {
        this.clock = options.clock ?? systemClock;
    }

    async resolve(identity: ConversationIdentity): Promise<ConversationScope> {
        return this.scopeOf(this.recordFor(identity));
    }

    async get(identity: ConversationIdentity): Promise<ConversationScope | undefined> {
        const record = this.records.get(identityId(identity));
        return record ? this.scopeOf(record) : undefined;
    }

    async activeRun(scope: ConversationScope): Promise<string | undefined> {
        assertConversationScope(scope);
        const record = this.records.get(scope.id);
        return record?.generation === scope.generation ? record.activeRunId : undefined;
    }

    async beginTurn(
        scope: ConversationScope,
        runId: string,
        text: string,
        limits: ResolvedConversationLimits,
    ): Promise<BeginTurnResult> {
        assertConversationScope(scope);
        assertRunId(runId);
        assertConversationText(text, CONVERSATION_LIMITS_MAX.maxItemBytes);

        const record = this.records.get(scope.id);
        if (!record || record.generation !== scope.generation) return { kind: 'stale' };
        const existing = record.snapshot;
        if (record.activeRunId === runId && existing) {
            return { kind: 'ready', snapshot: copy(existing) };
        }

        assertConversationText(text, limits.maxItemBytes);
        if (record.activeRunId !== undefined && record.activeRunId !== runId) {
            return { kind: 'busy', runId: record.activeRunId };
        }

        if (this.findItem(record, userItemId(runId))) {
            throw new InvalidRunStateError('The conversation turn has already ended.');
        }

        const now = this.clock.now();
        this.trimExpired(record, limits, now);

        const sent = this.generationItems(record).filter((item) => item.status === 'sent');
        const notes = record.notes.values().toArray().filter((note) => isNoteActive(note, now));
        const content = buildSnapshotContent(sent, notes, limits);

        record.items.push({
            generation: record.generation,
            item: {
                id: userItemId(runId),
                role: 'user',
                text,
                runId,
                createdAt: now,
                status: 'sent',
            },
        });
        this.trimCount(record, record.generation, limits.maxStoredItems);

        const snapshot: ConversationSnapshot = {
            scope: this.scopeOf(record),
            runId,
            ...content,
            createdAt: now,
        };
        record.snapshot = copy(snapshot);
        record.activeRunId = runId;
        return { kind: 'ready', snapshot: copy(snapshot) };
    }

    async endTurn(scope: ConversationScope, runId: string, confirmedEmitIds: string[]): Promise<void> {
        assertConversationScope(scope);
        assertRunId(runId);
        if (!Array.isArray(confirmedEmitIds) || confirmedEmitIds.some((id) => typeof id !== 'string')) {
            throw new ValidationError('The confirmed emit ids must be an array of strings.');
        }

        const record = this.records.get(scope.id);
        // only the owner of the current generation ends its turn; anything else is a no-op
        if (!record || record.generation !== scope.generation || record.activeRunId !== runId) return;

        const confirmed = new Set(confirmedEmitIds);
        for (const item of this.generationItems(record)) {
            if (item.runId !== runId || item.status !== 'pending') continue;
            item.status = confirmed.has(item.id) ? 'sent' : 'unknown';
        }
        record.activeRunId = undefined;
        record.snapshot = undefined;
    }

    async prepareEmit(scope: ConversationScope, item: ConversationItem): Promise<void> {
        const record = this.currentRecord(scope);
        if (!isObject(item) || record.activeRunId === undefined || item.runId !== record.activeRunId) {
            throw ownerError();
        }
        assertEmitItem(item);

        const stored = this.findItem(record, item.id);
        if (stored) {
            if (!isSameEmit(stored, item)) {
                throw new ValidationError('A conversation item of this id exists with other content.');
            }
            return;
        }

        const out: ConversationItem = {
            id: item.id,
            role: 'assistant',
            text: item.text,
            runId: item.runId,
            createdAt: this.clock.now(),
            status: 'pending',
        };
        if (item.effectKey !== undefined) out.effectKey = item.effectKey;
        if (item.target !== undefined) out.target = { channel: item.target.channel, address: item.target.address };
        record.items.push({ generation: record.generation, item: out });
    }

    async confirmEmit(scope: ConversationScope, itemId: string): Promise<void> {
        const record = this.currentRecord(scope);
        const item = typeof itemId === 'string' ? this.findItem(record, itemId) : undefined;
        if (!item || record.activeRunId === undefined || item.runId !== record.activeRunId) {
            throw ownerError();
        }
        // pending -> sent only
        if (item.status === 'pending') item.status = 'sent';
    }

    async pendingEmits(scope: ConversationScope, runId: string): Promise<ConversationItem[]> {
        assertConversationScope(scope);
        assertRunId(runId);
        const record = this.records.get(scope.id);
        if (!record) return [];
        return record.items
            .filter((entry) => entry.generation === scope.generation &&
                entry.item.runId === runId &&
                entry.item.status === 'pending')
            .map((entry) => copy(entry.item));
    }

    async listItems(
        scope: ConversationScope,
        query: { limit: number; offset: number },
    ): Promise<{ data: ConversationItem[]; total: number }> {
        assertConversationScope(scope);
        assertPage(query);
        const record = this.records.get(scope.id);
        const items = record ?
            record.items.filter((entry) => entry.generation === scope.generation).map((entry) => entry.item) :
            [];
        return {
            data: items.slice(query.offset, query.offset + query.limit).map((item) => copy(item)),
            total: items.length,
        };
    }

    async listNotes(
        scope: ConversationScope,
        query: { limit: number; offset: number },
    ): Promise<{ data: ConversationNote[]; total: number }> {
        assertConversationScope(scope);
        assertPage(query);
        const record = this.records.get(scope.id);
        if (!record || record.generation !== scope.generation) return { data: [], total: 0 };
        const now = this.clock.now();
        const notes = record.notes.values().toArray()
            .filter((note) => isNoteActive(note, now))
            .sort((a, b) => compareCodePoints(a.key, b.key));
        return {
            data: notes.slice(query.offset, query.offset + query.limit).map((note) => copy(note)),
            total: notes.length,
        };
    }

    async getNote(scope: ConversationScope, key: string): Promise<ConversationNote | undefined> {
        assertConversationScope(scope);
        const record = this.records.get(scope.id);
        if (!record || record.generation !== scope.generation || typeof key !== 'string') return undefined;
        const note = record.notes.get(key);
        return note && isNoteActive(note, this.clock.now()) ? copy(note) : undefined;
    }

    async applyNote(scope: ConversationScope, operation: ConversationNoteOperation): Promise<ConversationNoteResult> {
        const record = this.currentRecord(scope);
        const runId = isObject(operation) && isObject(operation.source) ? operation.source.runId : undefined;
        // ownership before any write or replay
        if (record.activeRunId === undefined || runId !== record.activeRunId) throw ownerError();
        assertNoteOperationShape(operation);

        const opKey = `${record.generation}:${operation.id}`;
        const recorded = record.operations.get(opKey);
        if (recorded) {
            if (recorded.inputHash !== operation.inputHash || recorded.runId !== operation.source.runId) {
                throw new ValidationError('The note operation was already applied with another input.');
            }
            return copy(recorded.result);
        }

        const now = this.clock.now();
        assertNoteOperationContent(operation, now);
        this.dropExpiredNotes(record, now);

        let result: ConversationNoteResult;
        if (operation.kind === 'set') {
            const previous = record.notes.get(operation.key);
            if (!previous && record.notes.size >= CONVERSATION_NOTES_MAX) {
                throw new ValidationError(`A conversation holds at most ${CONVERSATION_NOTES_MAX} notes.`);
            }
            const note: ConversationNote = {
                key: operation.key,
                text: operation.text,
                createdAt: previous ? previous.createdAt : now,
                updatedAt: now,
                source: {
                    runId: operation.source.runId,
                    toolCallId: operation.source.toolCallId,
                    stepIndex: operation.source.stepIndex,
                },
            };
            if (operation.expiresAt !== undefined) note.expiresAt = new Date(operation.expiresAt.getTime());
            record.notes.set(operation.key, note);
            result = {
                kind: 'set',
                key: operation.key,
                updatedAt: now,
            };
        } else {
            const removed = record.notes.delete(operation.key);
            result = {
                kind: 'remove',
                key: operation.key,
                removed,
            };
        }

        record.operations.set(opKey, {
            runId: operation.source.runId,
            inputHash: operation.inputHash,
            result: copy(result),
            createdAt: now,
        });
        return copy(result);
    }

    async reset(identity: ConversationIdentity, options: { keepNotes: boolean }): Promise<ConversationScope> {
        if (!isObject(options) || typeof options.keepNotes !== 'boolean') {
            throw new ValidationError('The reset options need keepNotes as a boolean.');
        }
        const record = this.recordFor(identity);
        if (record.activeRunId !== undefined) {
            throw new InvalidRunStateError('The conversation has an active turn and cannot be reset.');
        }
        record.generation += 1;
        record.snapshot = undefined;
        if (!options.keepNotes) {
            record.notes.clear();
            record.operations.clear();
        }
        // old transcript items stay under their generation until retention removes them
        return this.scopeOf(record);
    }

    async delete(identity: ConversationIdentity): Promise<void> {
        const record = this.records.get(identityId(identity));
        if (!record) return;
        if (record.activeRunId !== undefined) {
            throw new InvalidRunStateError('The conversation has an active turn and cannot be deleted.');
        }
        // the identity stays as a tombstone, so old-generation work never recreates it
        record.generation += 1;
        record.items = [];
        record.notes.clear();
        record.snapshot = undefined;
        record.operations.clear();
    }

    async prune(
        limits: ResolvedConversationLimits,
        options: { isSettled?: (runId: string) => Promise<boolean> } = {},
    ): Promise<void> {
        const now = this.clock.now();
        const candidates = new Map<string, {
            record: ScopeRecord;
            key: string;
            operation: StoredOperation
        }[]>();

        for (const record of this.records.values()) {
            this.trimExpired(record, limits, now);
            for (const generation of new Set(record.items.map((entry) => entry.generation))) {
                this.trimCount(record, generation, limits.maxStoredItems);
            }
            this.dropExpiredNotes(record, now);
            for (const [key, operation] of record.operations) {
                if (operation.runId === record.activeRunId) continue;
                if (!isExpired(operation.createdAt, limits.retentionMs, now)) continue;
                const list = candidates.get(operation.runId) ?? [];
                list.push({
                    record,
                    key,
                    operation,
                });
                candidates.set(operation.runId, list);
            }
        }

        // without a settled check, operation tombstones of recoverable runs are kept
        const { isSettled } = options;
        if (!isSettled) return;

        let failure: { error: unknown } | undefined;
        for (const [runId, list] of candidates) {
            let settled: boolean;
            try {
                settled = await isSettled(runId);
            } catch (error) {
                failure ??= { error };
                continue;
            }
            if (!settled) continue;
            for (const {
                record,
                key,
                operation,
            } of list) {
                // re-checked after the await: the record may have been replaced or its run become active
                if (record.operations.get(key) !== operation || record.activeRunId === runId) continue;
                record.operations.delete(key);
            }
        }
        if (failure) throw failure.error;
    }

    protected recordFor(identity: ConversationIdentity): ScopeRecord {
        assertConversationIdentity(identity);
        const id = identityId(identity);
        let record = this.records.get(id);
        if (!record) {
            record = {
                identity: {
                    agent: identity.agent,
                    channel: identity.channel,
                    account: identity.account,
                    chat: identity.chat,
                    audience: identity.audience,
                },
                generation: 0,
                items: [],
                notes: new Map(),
                operations: new Map(),
            };
            this.records.set(id, record);
        }
        return record;
    }

    /** The record of a scope's current generation, else a stale-scope error. */
    protected currentRecord(scope: ConversationScope): ScopeRecord {
        assertConversationScope(scope);
        const record = this.records.get(scope.id);
        if (!record || record.generation !== scope.generation) throw staleError();
        return record;
    }

    protected scopeOf(record: ScopeRecord): ConversationScope {
        return {
            id: identityId(record.identity),
            generation: record.generation,
            identity: { ...record.identity },
        };
    }

    protected generationItems(record: ScopeRecord): ConversationItem[] {
        return record.items
            .filter((entry) => entry.generation === record.generation)
            .map((entry) => entry.item);
    }

    protected findItem(record: ScopeRecord, id: string): ConversationItem | undefined {
        return record.items.find((entry) => entry.generation === record.generation && entry.item.id === id)?.item;
    }

    /** Drops items past retention, never the active turn's. */
    protected trimExpired(record: ScopeRecord, limits: ResolvedConversationLimits, now: Date): void {
        record.items = record.items.filter((entry) => entry.item.runId === record.activeRunId ||
            !isExpired(entry.item.createdAt, limits.retentionMs, now));
    }

    /** Keeps a generation's newest maxStoredItems items, never dropping the active turn's. */
    protected trimCount(record: ScopeRecord, generation: number, max: number): void {
        let excess = record.items.filter((entry) => entry.generation === generation).length - max;
        if (excess <= 0) return;
        record.items = record.items.filter((entry) => {
            if (excess <= 0 || entry.generation !== generation || entry.item.runId === record.activeRunId) {
                return true;
            }
            excess -= 1;
            return false;
        });
    }

    protected dropExpiredNotes(record: ScopeRecord, now: Date): void {
        for (const [key, note] of record.notes) {
            if (!isNoteActive(note, now)) record.notes.delete(key);
        }
    }
}
