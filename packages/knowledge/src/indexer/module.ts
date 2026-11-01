/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, ILockRepository } from '@chamvi/core';
import { ErrorCode, ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { CHUNKER_VERSION } from '../chunk/constants.ts';
import { managedNameError } from '../collection/helpers.ts';
import { chunkText, contentHash } from '../chunk/module.ts';
import type { KnowledgeErrorContext } from '../knowledge/types.ts';
import type {
    IKnowledgeRepository,
    KnowledgeChunkInput,
    KnowledgeCollection,
    KnowledgeDocument,
} from '../repository/types.ts';
import type { KnowledgeDocumentInput } from '../source/types.ts';
import {
    EMBED_BATCH_SIZE,
    KNOWLEDGE_LOCK_TTL_MS,
    KNOWLEDGE_RETRY_MAX_MS,
    KNOWLEDGE_RETRY_MS,
} from './constants.ts';
import {
    createIndexLock,
    lockKey,
    messageOf,
    sameDetails,
    servesDefinition,
    wait,
} from './helpers.ts';
import type { CollectionLoopInput, KnowledgeIndexLock, SyncCollectionInput } from './types.ts';

/** The record without a pending re-embed. */
function withoutPending(record: KnowledgeCollection): KnowledgeCollection {
    const rest = { ...record };

    delete rest.pending;

    return rest;
}

/** The record without a pending re-embed, a stored error or a backoff. */
function settled(record: KnowledgeCollection): KnowledgeCollection {
    const rest = withoutPending(record);

    delete rest.error;
    delete rest.failures;
    delete rest.retryAt;

    return rest;
}

/** The highest generation number the record ever gave out. */
function highestGeneration(record: KnowledgeCollection): number {
    return Math.max(record.generation, record.pending?.generation ?? 0, record.lastGeneration ?? 0);
}

/** The wait after the `failures`-th failure in a row: 5 s doubling, capped. */
function backoffOf(failures: number): number {
    return Math.min(KNOWLEDGE_RETRY_MS * (2 ** Math.min(Math.max(failures - 1, 0), 30)), KNOWLEDGE_RETRY_MAX_MS);
}

/** A configuration error (InvalidAgentDefinitionError, by code across core copies): retrying cannot help. */
function isConfigurationError(error: unknown): boolean {
    return isObject(error) && error.code === ErrorCode.INVALID_AGENT_DEFINITION;
}

function documentOf(
    collection: string,
    input: KnowledgeDocumentInput,
    hash: string,
    generation: number,
    updatedAt: Date,
): KnowledgeDocument {
    return {
        collection,
        id: input.id,
        content: input.content,
        hash,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        generation,
        updatedAt,
    };
}

/**
 * The vectors of one batch checked: one per text, numbers only, one length
 * across the generation (ValidationError otherwise); answers that length.
 */
function assertVectors(label: string, vectors: unknown, count: number, dimensions: number | undefined): number {
    if (!Array.isArray(vectors) || vectors.length !== count) {
        throw new ValidationError(`${label}: the embedding model returned no vector per text.`);
    }

    let length = dimensions;

    for (const vector of vectors) {
        const numbers = Array.isArray(vector) && vector.length > 0 && vector.every((value) => Number.isFinite(value));

        if (!numbers) {
            throw new ValidationError(`${label}: the embedding model returned a vector that is no list of numbers.`);
        }

        length ??= vector.length;

        if (vector.length !== length) {
            throw new ValidationError(
                `${label}: the embedding model returned ${vector.length}-dimensional vectors, the generation holds ${length}.`,
            );
        }
    }

    return length!;
}

/**
 * One pass over a declared collection: picks the generation to write (the
 * served one when model and chunker match, else the pending re-embed), embeds
 * every new or changed document into it, deletes the documents the sources no
 * longer yield (none when a source marked its read incomplete: reported once;
 * a re-embed then fails, retried on the backoff) and, for a re-embed, switches the served generation and deletes
 * the previous one. Unchanged documents cost nothing. Ends early, without an
 * error, once `lock.renew()` answers false.
 */
export async function syncCollection(input: SyncCollectionInput): Promise<void> {
    const {
        definition,
        repository,
        clock,
        signal,
        lock,
    } = input;
    const { name } = definition;
    const label = `Knowledge collection "${name}"`;
    const stored = await repository.findOneCollection(name);

    if (stored?.kind === 'managed') {
        throw managedNameError(name);
    }

    const startedAt = clock.now();
    let record: KnowledgeCollection = {
        ...(stored ?? {
            name,
            kind: 'declared',
            generation: 0,
            model: definition.model,
            chunker: CHUNKER_VERSION,
            status: 'pending',
            createdAt: startedAt,
        }),
        // a downgrade is immediate, an upgrade waits for the end: until then the
        // served chunks may still hold the previous sources' content
        trusted: stored ? stored.trusted && definition.trusted : definition.trusted,
        updatedAt: startedAt,
    };
    let target: number;
    let abandoned: number | undefined;
    const serves = servesDefinition(record, definition);

    if (serves) {
        // a pending re-embed toward another model is dropped (the served model came back)
        target = record.generation;
        record = {
            ...withoutPending(record),
            lastGeneration: highestGeneration(record),
            status: 'ready',
        };
    } else if (record.pending?.model === definition.model && record.pending.chunker === CHUNKER_VERSION) {
        target = record.pending.generation;
    } else {
        abandoned = record.pending?.generation;
        // never a number given out before: documents of an abandoned generation still name it
        target = highestGeneration(record) + 1;
        record = {
            ...record,
            pending: {
                generation: target,
                model: definition.model,
                chunker: CHUNKER_VERSION,
            },
            lastGeneration: target,
        };
    }

    if (target !== record.generation) {
        record = { ...record, status: record.generation > 0 ? 'stale' : 'pending' };
    }

    await repository.saveCollection(record);

    if (serves) {
        // also what a crash between an earlier switch and its cleanup left behind
        await repository.deleteGenerationsExcept(name, target);
    } else if (abandoned !== undefined) {
        await repository.deleteGeneration(name, abandoned);
    }

    let dimensions = target === record.generation ? record.dimensions : record.pending?.dimensions;
    const seen = new Set<string>();
    // what the sources could not read this pass (an unlistable folder, a read error)
    const missed: string[] = [];
    const context = {
        signal,
        onError: input.onError,
        incomplete: (reason: string) => {
            missed.push(typeof reason === 'string' && reason.length > 0 ? reason : 'no reason given');
        },
    };

    for (const source of definition.sources) {
        for await (const document of source.documents(context)) {
            signal.throwIfAborted();

            if (seen.has(document.id)) {
                input.onError(new ValidationError(
                    `${label}: document "${document.id}" is yielded by more than one source; the first is kept.`,
                ));

                continue;
            }

            seen.add(document.id);

            if (!await lock.renew()) {
                return;
            }

            const hash = contentHash(document.content);
            const existing = await repository.findOneDocument(name, document.id);

            if (existing && existing.hash === hash && existing.generation === target) {
                if (!sameDetails(existing, document)) {
                    await repository.saveDocument(documentOf(name, document, hash, target, clock.now()));
                }

                continue;
            }

            const chunks = chunkText(document.content);
            const inputs: KnowledgeChunkInput[] = [];

            for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH_SIZE) {
                const batch = chunks.slice(offset, offset + EMBED_BATCH_SIZE);
                const vectors = await input.embed(definition.model, batch.map((chunk) => chunk.text), signal);
                const learned = dimensions === undefined;

                dimensions = assertVectors(label, vectors, batch.length, dimensions);

                if (learned && record.pending && target === record.pending.generation) {
                    record = { ...record, pending: { ...record.pending, dimensions } };
                    await repository.saveCollection(record);
                }

                for (const [index, chunk] of batch.entries()) {
                    inputs.push({ ...chunk, vector: vectors[index]! });
                }
            }

            signal.throwIfAborted();

            // embedding may have outlasted the lease: never write once another owner may hold it
            if (!await lock.renew()) {
                return;
            }

            await repository.replaceChunks(name, document.id, target, inputs);
            await repository.saveDocument(documentOf(name, document, hash, target, clock.now()));
        }
    }

    signal.throwIfAborted();

    if (!await lock.renew()) {
        return;
    }

    if (missed.length > 0) {
        const partial = `${label}: a source read only part of its documents (${missed[0]}` +
            `${missed.length > 1 ? `, and ${missed.length - 1} more` : ''})`;

        if (target !== record.generation) {
            // the documents it missed live in the served generation only: switching would drop them
            throw new ValidationError(`${partial}; the re-embed waits for a complete read.`);
        }

        // a document it could not read is no deleted document
        input.onError(new ValidationError(`${partial}; no document was deleted.`));
    } else {
        for (const id of await repository.findDocumentIds(name)) {
            if (!seen.has(id)) {
                await repository.deleteDocument(name, id);
            }
        }
    }

    const finishedAt = clock.now();

    if (target === record.generation) {
        await repository.saveCollection({
            ...settled(record),
            trusted: definition.trusted,
            ...(dimensions === undefined ? {} : { dimensions }),
            status: 'ready',
            updatedAt: finishedAt,
        });

        return;
    }

    const previous = record.generation;
    // the previous model's length never carries over: a switch without a chunk learned none
    const switched = settled(record);

    delete switched.dimensions;

    await repository.saveCollection({
        ...switched,
        trusted: definition.trusted,
        generation: target,
        model: definition.model,
        ...(dimensions === undefined ? {} : { dimensions }),
        chunker: CHUNKER_VERSION,
        status: 'ready',
        updatedAt: finishedAt,
    });

    if (previous > 0) {
        await repository.deleteGeneration(name, previous);
    }
}

/**
 * Stores a failure on the declared record (never on a managed one), only while
 * the lock is still this owner's: a lost lock leaves the record to its holder.
 * The failure count and the time of the next attempt go with it, so every
 * replica backs off together. Whether it was stored.
 */
async function recordErrorUnderLock(
    repository: IKnowledgeRepository,
    name: string,
    error: unknown,
    clock: IClock,
    lock: KnowledgeIndexLock,
): Promise<boolean> {
    if (!await lock.renew()) {
        return false;
    }

    const record = await repository.findOneCollection(name);

    if (record?.kind !== 'declared') {
        return false;
    }

    const now = clock.now();
    const failures = (record.failures ?? 0) + 1;

    await repository.saveCollection({
        ...record,
        error: messageOf(error),
        failures,
        retryAt: new Date(now.getTime() + backoffOf(failures)),
        updatedAt: now,
    });

    return true;
}

/** How long until the stored backoff of the collection ends (0 when none). */
async function retryDelayOf(repository: IKnowledgeRepository, name: string, clock: IClock): Promise<number> {
    const record = await repository.findOneCollection(name);
    const retryAt = record?.kind === 'declared' ? record.retryAt : undefined;

    if (!retryAt) {
        return 0;
    }

    // a clock skewed between replicas never parks the loop longer than the cap
    return Math.min(Math.max(retryAt.getTime() - clock.now().getTime(), 0), KNOWLEDGE_RETRY_MAX_MS);
}

/**
 * Indexes one declared collection until it is current: syncs under the store
 * lock `knowledge:<name>`; while another owner holds it, waits
 * `KNOWLEDGE_RETRY_MS` and tries again, so this replica's own sources are
 * synced once the lock is free (an unchanged document embeds nothing). A failure is stored with the time of the next attempt
 * (still under the lock, so no replica's later sync is overwritten) and
 * reported; every replica waits for that time before it takes the lock again
 * (5 s doubling to `KNOWLEDGE_RETRY_MAX_MS` per failure in a row, across
 * replicas), except on its own first attempt. A configuration error
 * (InvalidAgentDefinitionError) is stored and reported once and ends the
 * loop. A failed lock acquire or store read is only reported and retried on
 * this loop's own backoff. Never rejects; an abort ends it.
 */
export async function runCollection(input: CollectionLoopInput): Promise<void> {
    const {
        definition,
        repository,
        locks,
        owner,
        clock,
        signal,
    } = input;
    const { name } = definition;
    const key = lockKey(name);
    const context: KnowledgeErrorContext = { collection: name };
    const report = (error: unknown) => input.onError(error, context);
    // this loop's own backoff, for store failures that leave no stored retry time
    let delay = KNOWLEDGE_RETRY_MS;
    let first = true;
    const backOff = async () => {
        await wait(clock, delay, signal);
        delay = Math.min(delay * 2, KNOWLEDGE_RETRY_MAX_MS);
    };

    while (!signal.aborted) {
        const honourRetry = !first;
        let acquired: boolean;

        first = false;

        try {
            const retryIn = honourRetry ? await retryDelayOf(repository, name, clock) : 0;

            if (retryIn > 0) {
                await wait(clock, retryIn, signal);

                if (signal.aborted) {
                    return;
                }
            }

            acquired = await locks.acquire(key, owner, KNOWLEDGE_LOCK_TTL_MS);
        } catch (error) {
            if (signal.aborted) {
                return;
            }

            report(error);
            await backOff();

            continue;
        }

        if (acquired) {
            const lock = createIndexLock(locks, key, owner, clock);
            let failure: { error: unknown; stored: boolean } | undefined;
            let deferred = false;

            try {
                // another replica may have failed between our wait and the acquire
                deferred = honourRetry && await retryDelayOf(repository, name, clock) > 0;

                if (!deferred) {
                    await syncCollection({
                        ...input,
                        lock,
                        onError: report,
                    });
                }
            } catch (error) {
                failure = { error, stored: false };

                if (!signal.aborted) {
                    failure.stored = await recordErrorUnderLock(repository, name, error, clock, lock).catch((recordError: unknown) => {
                        report(recordError);

                        return false;
                    });
                }
            } finally {
                await locks.release(key, owner).catch(report);
            }

            if (signal.aborted) {
                return;
            }

            if (deferred) {
                continue;
            }

            if (failure) {
                report(failure.error);

                if (isConfigurationError(failure.error)) {
                    return;
                }

                if (!failure.stored) {
                    await backOff();
                }

                continue;
            }

            if (!lock.lost) {
                return;
            }
        }

        // the holder may sync other sources than this replica's: wait for the
        // lock and sync ours (content hashes make an unchanged sync embed nothing)
        await wait(clock, KNOWLEDGE_RETRY_MS, signal);
    }
}

/**
 * Marks every declared record without a definition `orphaned`: kept with its
 * documents and chunks, searchable by no agent. Each mark is written under
 * the record's `knowledge:<name>` lock (a held one means a replica that
 * declares it is syncing it: left alone), re-read once the lock is held.
 */
export async function markOrphans(
    repository: IKnowledgeRepository,
    declared: ReadonlySet<string>,
    locks: ILockRepository,
    owner: string,
    clock: IClock,
): Promise<void> {
    const isOrphan = (record: KnowledgeCollection | undefined): record is KnowledgeCollection => record !== undefined &&
        record.kind === 'declared' &&
        record.status !== 'orphaned' &&
        !declared.has(record.name);

    for (const candidate of await repository.findCollections()) {
        if (!isOrphan(candidate)) {
            continue;
        }

        const key = lockKey(candidate.name);

        if (!await locks.acquire(key, owner, KNOWLEDGE_LOCK_TTL_MS)) {
            continue;
        }

        try {
            const record = await repository.findOneCollection(candidate.name);

            if (isOrphan(record)) {
                await repository.saveCollection({
                    ...record,
                    status: 'orphaned',
                    updatedAt: clock.now(),
                });
            }
        } finally {
            await locks.release(key, owner);
        }
    }
}
