/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    CONVERSATION_LIMITS_MAX,
    CONVERSATION_NOTES_MAX,
    InvalidRunStateError,
    RepositoryNotFoundError,
    ValidationError,
    systemClock,
} from '@chamvi/core';
import type {
    BeginTurnResult,
    ConversationFindOptions,
    ConversationIdentity,
    ConversationItem,
    ConversationNote,
    ConversationNoteOperation,
    ConversationNoteResult,
    ConversationScope,
    ConversationSnapshot,
    IConversationRepository,
    ResolvedConversationLimits,
} from '@chamvi/core';
import { In, LessThanOrEqual, Not } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { isObject } from 'smob';
import {
    ConversationEntity,
    ConversationItemEntity,
    ConversationNoteEntity,
    ConversationOperationEntity,
} from '../entities/index.ts';
import { asValues } from '../repository/helpers.ts';
import {
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
} from '@chamvi/core/conversation/persistence';
import type { DatabaseConversationRepositoryOptions } from './types.ts';

const ENDED_TURN = {
    activeRunId: null,
    snapshotMessages: null,
    snapshotItemIds: null,
    snapshotNoteKeys: null,
    snapshotCreatedAt: null,
    snapshotOmitted: null,
};

function scopeOf(row: ConversationEntity): ConversationScope {
    return {
        id: row.id,
        generation: row.generation,
        identity: {
            agent: row.agent,
            channel: row.channel,
            account: row.account,
            chat: row.chat,
            audience: row.audience,
        },
    };
}

function itemOf(row: ConversationItemEntity): ConversationItem {
    return {
        id: row.id,
        role: row.role,
        text: row.text,
        runId: row.runId,
        createdAt: row.createdAt,
        status: row.status,
        ...(row.effectKey === null ? {} : { effectKey: row.effectKey }),
        ...(row.targetChannel === null ? {} : { target: { channel: row.targetChannel, address: row.targetAddress! } }),
    };
}

function itemValues(item: ConversationItem) {
    return {
        id: item.id,
        role: item.role,
        text: item.text,
        runId: item.runId,
        createdAt: item.createdAt,
        status: item.status,
        effectKey: item.effectKey ?? null,
        targetChannel: item.target?.channel ?? null,
        targetAddress: item.target?.address ?? null,
    };
}

function noteOf(row: ConversationNoteEntity): ConversationNote {
    return {
        key: row.key,
        text: row.text,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        source: {
            runId: row.runId,
            toolCallId: row.toolCallId,
            stepIndex: row.stepIndex,
        },
        ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
    };
}

function noteValues(note: ConversationNote) {
    return {
        key: note.key,
        text: note.text,
        ...note.source,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        expiresAt: note.expiresAt ?? null,
    };
}

/** Every write takes the identity row lock before any owned rows, across connections. */
export class DatabaseConversationRepository implements IConversationRepository {
    protected dataSource;

    protected clock;

    constructor(options: DatabaseConversationRepositoryOptions) {
        this.dataSource = options.dataSource;
        this.clock = options.clock ?? systemClock;
    }

    protected get conversations(): Repository<ConversationEntity> {
        return this.dataSource.getRepository(ConversationEntity);
    }

    protected get items(): Repository<ConversationItemEntity> {
        return this.dataSource.getRepository(ConversationItemEntity);
    }

    protected get notes(): Repository<ConversationNoteEntity> {
        return this.dataSource.getRepository(ConversationNoteEntity);
    }

    protected get operations(): Repository<ConversationOperationEntity> {
        return this.dataSource.getRepository(ConversationOperationEntity);
    }

    async resolve(identity: ConversationIdentity): Promise<ConversationScope> {
        const id = identityId(identity);
        await this.conversations.createQueryBuilder().insert()
            .values(asValues<ConversationEntity>({
                id,
                agent: identity.agent,
                channel: identity.channel,
                account: identity.account,
                chat: identity.chat,
                audience: identity.audience,
                generation: 0,
                activeRunId: null,
            })).orIgnore().execute();
        return scopeOf(await this.conversations.findOneByOrFail({ id }));
    }

    async findOne(identity: ConversationIdentity): Promise<ConversationScope | undefined> {
        const row = await this.conversations.findOneBy({ id: identityId(identity) });
        return row ? scopeOf(row) : undefined;
    }

    async findOneOrFail(identity: ConversationIdentity): Promise<ConversationScope> {
        const result = await this.findOne(identity);
        if (result === undefined) throw new RepositoryNotFoundError('conversations');
        return result;
    }

    protected async locked<T>(id: string, fn: (manager: EntityManager, row: ConversationEntity | null) => Promise<T>): Promise<T> {
        // withDatabaseLock is session-advisory; this row lock must share the writes' transaction.
        return this.dataSource.transaction(async (manager) => {
            const row = await manager.withRepository(this.conversations).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
            return fn(manager, row);
        });
    }

    protected current(scope: ConversationScope, row: ConversationEntity | null): ConversationEntity {
        if (!row || row.generation !== scope.generation) {
            throw new InvalidRunStateError('The conversation scope is stale: it was reset or deleted.');
        }
        return row;
    }

    protected owner(row: ConversationEntity, runId: string): void {
        if (row.activeRunId === null || row.activeRunId !== runId) {
            throw new InvalidRunStateError('The run does not hold the conversation turn.');
        }
    }

    async activeRun(scope: ConversationScope): Promise<string | undefined> {
        assertConversationScope(scope);
        const row = await this.conversations.findOneBy({ id: scope.id, generation: scope.generation });
        return row?.activeRunId ?? undefined;
    }

    async beginTurn(scope: ConversationScope, runId: string, text: string, limits: ResolvedConversationLimits): Promise<BeginTurnResult> {
        assertConversationScope(scope);
        assertRunId(runId);
        assertConversationText(text, CONVERSATION_LIMITS_MAX.maxItemBytes);
        return this.locked(scope.id, async (manager, row) => {
            if (!row || row.generation !== scope.generation) return { kind: 'stale' };
            const where = { scopeId: scope.id, generation: scope.generation };
            if (row.activeRunId === runId && row.snapshotCreatedAt !== null) {
                return {
                    kind: 'ready',
                    snapshot: {
                        scope: scopeOf(row),
                        runId,
                        createdAt: row.snapshotCreatedAt,
                        messages: row.snapshotMessages!,
                        itemIds: row.snapshotItemIds!,
                        noteKeys: row.snapshotNoteKeys!,
                        omitted: row.snapshotOmitted!,
                    },
                };
            }
            assertConversationText(text, limits.maxItemBytes);
            if (row.activeRunId !== null && row.activeRunId !== runId) return { kind: 'busy', runId: row.activeRunId };
            if (await manager.existsBy(ConversationItemEntity, { ...where, id: userItemId(runId) })) {
                throw new InvalidRunStateError('The conversation turn has already ended.');
            }
            await this.trim(manager, row, limits);
            const { items, total } = await this.recallItems(manager, scope, limits);
            const notes = await this.readNotes(manager, scope);
            const now = this.clock.now();
            const snapshot: ConversationSnapshot = {
                scope: scopeOf(row),
                runId,
                createdAt: now,
                ...buildSnapshotContent(items, notes, limits),
                omitted: total - items.length,
            };
            const item: ConversationItem = {
                id: userItemId(runId),
                role: 'user',
                text,
                runId,
                createdAt: now,
                status: 'sent',
            };
            await manager.withRepository(this.items).insert(asValues<ConversationItemEntity>({
                ...where,
                ...itemValues(item),
            }));
            await manager.update(ConversationEntity, { id: row.id }, asValues<ConversationEntity>({
                activeRunId: runId,
                snapshotCreatedAt: now,
                snapshotMessages: snapshot.messages,
                snapshotItemIds: snapshot.itemIds,
                snapshotNoteKeys: snapshot.noteKeys,
                snapshotOmitted: snapshot.omitted,
            }));
            await this.trimCount(manager, row.id, row.generation, row.activeRunId, limits.maxStoredItems);
            return { kind: 'ready', snapshot };
        });
    }

    protected async recallItems(manager: EntityManager, scope: ConversationScope, limits: ResolvedConversationLimits) {
        const where = {
            scopeId: scope.id,
            generation: scope.generation,
            status: 'sent' as const,
        };
        const total = await manager.countBy(ConversationItemEntity, where);
        let items: ConversationItem[] = [];
        let bytes = 0;
        let before: string | undefined;
        while (items.length < limits.maxItems && bytes < limits.maxHistoryBytes) {
            const query = manager.withRepository(this.items).createQueryBuilder('item')
                .where(where)
                // Find options cannot compare a text column's UTF-8 byte length.
                .andWhere('octet_length(item.text) <= :maxBytes', { maxBytes: limits.maxHistoryBytes - bytes })
                .orderBy('item.seq', 'DESC').take(100);
            if (before !== undefined) query.andWhere('item.seq < :before', { before });
            const page = await query.getMany();
            if (page.length === 0) break;
            before = page[page.length - 1]!.seq;
            // Newer selected records keep priority; previously skipped records cannot fit a smaller remaining budget.
            const candidates = [...page.reverse().map(itemOf), ...items];
            const selected = new Set(buildSnapshotContent(candidates, [], limits).itemIds);
            items = candidates.filter((item) => selected.has(item.id));
            bytes = items.reduce((sum, item) => sum + Buffer.byteLength(item.text, 'utf8'), 0);
        }
        return { items, total };
    }

    async endTurn(scope: ConversationScope, runId: string, confirmedEmitIds: string[]): Promise<void> {
        assertConversationScope(scope);
        assertRunId(runId);
        if (!Array.isArray(confirmedEmitIds) || confirmedEmitIds.some((id) => typeof id !== 'string')) {
            throw new ValidationError('The confirmed emit ids must be an array of strings.');
        }
        await this.locked(scope.id, async (manager, row) => {
            if (!row || row.generation !== scope.generation || row.activeRunId !== runId) return;
            const pending = await this.pending(manager, scope, runId);
            for (const entry of pending) {
                await manager.update(ConversationItemEntity, { seq: entry.seq }, { status: confirmedEmitIds.includes(entry.id) ? 'sent' : 'unknown' });
            }
            await manager.update(ConversationEntity, { id: row.id }, ENDED_TURN);
        });
    }

    async prepareEmit(scope: ConversationScope, item: ConversationItem): Promise<void> {
        assertConversationScope(scope);
        await this.locked(scope.id, async (manager, row) => {
            const current = this.current(scope, row);
            this.owner(current, item?.runId);
            assertEmitItem(item);
            const where = {
                scopeId: scope.id,
                generation: scope.generation,
                id: item.id,
            };
            const previous = await manager.findOneBy(ConversationItemEntity, where);
            if (previous) {
                if (!isSameEmit(itemOf(previous), item)) throw new ValidationError('A conversation item of this id exists with other content.');
                return;
            }
            const createdAt = this.clock.now();
            await manager.withRepository(this.items).insert(asValues<ConversationItemEntity>({
                ...where,
                ...itemValues(item),
                createdAt,
            }));
        });
    }

    async confirmEmit(scope: ConversationScope, itemId: string): Promise<void> {
        assertConversationScope(scope);
        await this.locked(scope.id, async (manager, row) => {
            const current = this.current(scope, row);
            const entry = typeof itemId === 'string' ? await manager.findOneBy(ConversationItemEntity, {
                scopeId: scope.id,
                generation: scope.generation,
                id: itemId,
            }) : null;
            if (!entry) throw new InvalidRunStateError('The run does not hold the conversation turn.');
            this.owner(current, entry.runId);
            if (entry.status === 'pending') {
                await manager.update(ConversationItemEntity, { seq: entry.seq }, { status: 'sent' });
            }
        });
    }

    protected async pending(manager: EntityManager, scope: ConversationScope, runId: string): Promise<ConversationItemEntity[]> {
        const items = await manager.find(ConversationItemEntity, {
            where: {
                scopeId: scope.id,
                generation: scope.generation,
                runId,
            },
            order: { seq: 'ASC' },
        });
        return items.filter((entry) => entry.status === 'pending');
    }

    async pendingEmits(scope: ConversationScope, runId: string): Promise<ConversationItem[]> {
        assertConversationScope(scope);
        assertRunId(runId);
        return (await this.pending(this.dataSource.manager, scope, runId)).map(itemOf);
    }

    async findItems(scope: ConversationScope, query: ConversationFindOptions): Promise<{ data: ConversationItem[]; total: number }> {
        assertConversationScope(scope);
        assertPage(query);
        const [rows, total] = await this.items.findAndCount({
            where: { scopeId: scope.id, generation: scope.generation },
            order: { seq: 'ASC' },
            skip: query.offset,
            take: query.limit,
        });
        return { data: rows.map(itemOf), total };
    }

    async findItemsOrFail(scope: ConversationScope, query: ConversationFindOptions): Promise<{ data: ConversationItem[]; total: number }> {
        const result = await this.findItems(scope, query);
        if (result.data.length === 0) throw new RepositoryNotFoundError('conversation items');
        return result;
    }

    protected async readNotes(manager: EntityManager, scope: ConversationScope): Promise<ConversationNote[]> {
        const current = await manager.findOneBy(ConversationEntity, { id: scope.id, generation: scope.generation });
        if (!current) return [];
        const rows = await manager.withRepository(this.notes).createQueryBuilder('note')
            .where('note.scopeId = :id AND note.generation = :generation', scope)
            .andWhere('(note.expiresAt IS NULL OR note.expiresAt > :now)', { now: this.clock.now() }).orderBy('note.key', 'ASC').getMany();
        return rows.map(noteOf);
    }

    async findNotes(scope: ConversationScope, query: ConversationFindOptions): Promise<{ data: ConversationNote[]; total: number }> {
        assertConversationScope(scope);
        assertPage(query);
        const notes = await this.readNotes(this.dataSource.manager, scope);
        return { data: notes.slice(query.offset, query.offset + query.limit), total: notes.length };
    }

    async findNotesOrFail(scope: ConversationScope, query: ConversationFindOptions): Promise<{ data: ConversationNote[]; total: number }> {
        const result = await this.findNotes(scope, query);
        if (result.data.length === 0) throw new RepositoryNotFoundError('conversation notes');
        return result;
    }

    async findOneNote(scope: ConversationScope, key: string): Promise<ConversationNote | undefined> {
        assertConversationScope(scope);
        if (typeof key !== 'string') return undefined;
        return (await this.readNotes(this.dataSource.manager, scope)).find((note) => note.key === key);
    }

    async findOneNoteOrFail(scope: ConversationScope, key: string): Promise<ConversationNote> {
        const result = await this.findOneNote(scope, key);
        if (result === undefined) throw new RepositoryNotFoundError('conversation notes');
        return result;
    }

    async applyNote(scope: ConversationScope, operation: ConversationNoteOperation): Promise<ConversationNoteResult> {
        assertConversationScope(scope);
        return this.locked(scope.id, async (manager, row) => {
            const current = this.current(scope, row);
            this.owner(current, operation?.source?.runId);
            assertNoteOperationShape(operation);
            const where = { scopeId: scope.id, generation: scope.generation };
            const previous = await manager.findOneBy(ConversationOperationEntity, { ...where, id: operation.id });
            if (previous) {
                if (previous.runId !== operation.source.runId || previous.inputHash !== operation.inputHash) throw new ValidationError('The note operation was already applied with another input.');
                return previous.kind === 'set' ?
                    {
                        kind: 'set',
                        key: previous.key,
                        updatedAt: previous.createdAt,
                    } :
                    {
                        kind: 'remove',
                        key: previous.key,
                        removed: previous.removed!,
                    };
            }
            const now = this.clock.now();
            assertNoteOperationContent(operation, now);
            await manager.delete(ConversationNoteEntity, { ...where, expiresAt: LessThanOrEqual(now) });
            const prior = await manager.findOneBy(ConversationNoteEntity, { ...where, key: operation.key });
            let result: ConversationNoteResult;
            if (operation.kind === 'set') {
                if (!prior && await manager.countBy(ConversationNoteEntity, where) >= CONVERSATION_NOTES_MAX) throw new ValidationError(`A conversation holds at most ${CONVERSATION_NOTES_MAX} notes.`);
                const note: ConversationNote = {
                    key: operation.key,
                    text: operation.text,
                    source: structuredClone(operation.source),
                    createdAt: prior?.createdAt ?? now,
                    updatedAt: now,
                };
                if (operation.expiresAt !== undefined) note.expiresAt = operation.expiresAt;
                await manager.withRepository(this.notes).upsert(asValues<ConversationNoteEntity>({
                    ...where,
                    ...noteValues(note),
                }), ['scopeId', 'generation', 'key']);
                result = {
                    kind: 'set',
                    key: note.key,
                    updatedAt: now,
                };
            } else {
                await manager.delete(ConversationNoteEntity, { ...where, key: operation.key });
                result = {
                    kind: 'remove',
                    key: operation.key,
                    removed: prior !== null,
                };
            }
            await manager.withRepository(this.operations).insert(asValues<ConversationOperationEntity>({
                ...where,
                id: operation.id,
                runId: operation.source.runId,
                inputHash: operation.inputHash,
                kind: result.kind,
                key: result.key,
                removed: result.kind === 'remove' ? result.removed : null,
                createdAt: now,
            }));
            return result;
        });
    }

    async reset(identity: ConversationIdentity, options: { keepNotes: boolean }): Promise<ConversationScope> {
        if (!isObject(options) || typeof options.keepNotes !== 'boolean') throw new ValidationError('The reset options need keepNotes as a boolean.');
        const scope = await this.resolve(identity);
        return this.locked(scope.id, async (manager, row) => {
            if (!row || row.activeRunId !== null) throw new InvalidRunStateError('The conversation has an active turn and cannot be reset.');
            row.generation += 1;
            await manager.update(ConversationEntity, { id: row.id }, { generation: row.generation, ...ENDED_TURN });
            if (options.keepNotes) {
                await manager.delete(ConversationNoteEntity, { scopeId: row.id, expiresAt: LessThanOrEqual(this.clock.now()) });
                await manager.update(ConversationNoteEntity, { scopeId: row.id }, { generation: row.generation });
            } else {
                await manager.delete(ConversationNoteEntity, { scopeId: row.id });
                await manager.delete(ConversationOperationEntity, { scopeId: row.id });
            }
            return scopeOf(row);
        });
    }

    async delete(identity: ConversationIdentity): Promise<void> {
        const id = identityId(identity);
        await this.locked(id, async (manager, row) => {
            if (!row) return;
            if (row.activeRunId !== null) throw new InvalidRunStateError('The conversation has an active turn and cannot be deleted.');
            await manager.update(ConversationEntity, { id }, { generation: row.generation + 1, ...ENDED_TURN });
            for (const entity of [ConversationItemEntity, ConversationNoteEntity, ConversationOperationEntity]) {
                await manager.delete(entity, { scopeId: id });
            }
        });
    }

    protected async trimCount(manager: EntityManager, scopeId: string, generation: number, activeRunId: string | null, max: number): Promise<void> {
        const where = { scopeId, generation };
        let excess = await manager.countBy(ConversationItemEntity, where) - max;
        while (excess > 0) {
            const candidates = await manager.find(ConversationItemEntity, {
                select: { seq: true },
                where: { ...where, ...(activeRunId === null ? {} : { runId: Not(activeRunId) }) },
                order: { seq: 'ASC' },
                take: Math.min(excess, 100),
            });
            if (candidates.length === 0) break;
            await manager.delete(ConversationItemEntity, { seq: In(candidates.map((entry) => entry.seq)) });
            excess -= candidates.length;
        }
    }

    protected async trim(manager: EntityManager, row: ConversationEntity, limits: ResolvedConversationLimits): Promise<void> {
        const before = new Date(this.clock.now().getTime() - limits.retentionMs);
        for (;;) {
            const expired = await manager.find(ConversationItemEntity, {
                select: { seq: true },
                where: {
                    scopeId: row.id,
                    createdAt: LessThanOrEqual(before),
                    ...(row.activeRunId === null ? {} : { runId: Not(row.activeRunId) }),
                },
                order: { seq: 'ASC' },
                take: 100,
            });
            if (expired.length === 0) break;
            await manager.delete(ConversationItemEntity, { seq: In(expired.map((entry) => entry.seq)) });
        }
        await manager.delete(ConversationNoteEntity, { scopeId: row.id, expiresAt: LessThanOrEqual(this.clock.now()) });
    }

    async prune(limits: ResolvedConversationLimits, options: { isSettled?: (runId: string) => Promise<boolean> } = {}): Promise<void> {
        const { isSettled } = options;
        let failure: { error: unknown } | undefined;
        let after = '';
        for (;;) {
            const page = await this.conversations.createQueryBuilder('scope').where('scope.id > :after', { after }).orderBy('scope.id', 'ASC').take(100).getMany();
            if (page.length === 0) break;
            for (const scope of page) {
                await this.locked(scope.id, async (manager, row) => {
                    if (!row) return;
                    await this.trim(manager, row, limits);
                    const generations = await manager.withRepository(this.items).createQueryBuilder('item')
                        .select('item.generation', 'generation')
                        .where('item.scopeId = :id', { id: row.id })
                        .distinct(true).getRawMany<{ generation: number }>();
                    for (const { generation } of generations) {
                        await this.trimCount(manager, row.id, generation, row.activeRunId, limits.maxStoredItems);
                    }
                });
                if (!isSettled) continue;
                let afterOperation: { generation: number; id: string } | undefined;
                for (;;) {
                    const candidates = await this.locked(scope.id, async (manager, row) => {
                        if (!row) return [];
                        const before = new Date(this.clock.now().getTime() - limits.retentionMs);
                        const query = manager.withRepository(this.operations).createQueryBuilder('operation')
                            .where({
                                scopeId: row.id,
                                createdAt: LessThanOrEqual(before),
                                ...(row.activeRunId === null ? {} : { runId: Not(row.activeRunId) }),
                            })
                            .orderBy('operation.generation', 'ASC').addOrderBy('operation.id', 'ASC').take(100);
                        if (afterOperation) {
                            query.andWhere('(operation.generation > :generation OR (operation.generation = :generation AND operation.id > :id))', afterOperation);
                        }
                        return query.getMany();
                    });
                    if (candidates.length === 0) break;
                    const settled: ConversationOperationEntity[] = [];
                    // A classifier may need this same pool; call it without a transaction connection.
                    for (const candidate of candidates) {
                        try {
                            if (await isSettled(candidate.runId)) settled.push(candidate);
                        } catch (error) {
                            failure ??= { error };
                        }
                    }
                    if (settled.length > 0) {
                        await this.locked(scope.id, async (manager, row) => {
                            if (!row) return;
                            const before = this.clock.now().getTime() - limits.retentionMs;
                            for (const candidate of settled) {
                                if (row.activeRunId === candidate.runId || candidate.createdAt.getTime() > before) continue;
                                await manager.delete(ConversationOperationEntity, {
                                    scopeId: row.id,
                                    generation: candidate.generation,
                                    id: candidate.id,
                                    runId: candidate.runId,
                                    inputHash: candidate.inputHash,
                                    createdAt: candidate.createdAt,
                                });
                            }
                        });
                    }
                    afterOperation = candidates[candidates.length - 1]!;
                }
            }
            after = page[page.length - 1]!.id;
        }
        if (failure) throw failure.error;
    }
}
