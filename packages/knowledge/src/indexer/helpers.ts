/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, ILockRepository } from '@chamvi/core';
import { CHUNKER_VERSION } from '../chunk/constants.ts';
import type { ResolvedKnowledgeCollection } from '../collection/types.ts';
import type { KnowledgeCollection, KnowledgeDocument } from '../repository/types.ts';
import type { KnowledgeDocumentInput } from '../source/types.ts';
import { KNOWLEDGE_LOCK_TTL_MS } from './constants.ts';
import type { KnowledgeIndexLock } from './types.ts';

/** The store lock of a collection's indexer. */
export function lockKey(collection: string): string {
    return `knowledge:${collection}`;
}

export function messageOf(error: unknown): string {
    return Error.isError(error) ? error.message : String(error);
}

/** Resolves after `ms` on the clock, or at once when `signal` aborts (the timer cleared). */
export function wait(clock: IClock, ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const done = () => {
            timer.clear();
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = clock.setTimeout(done, ms);

        signal.addEventListener('abort', done, { once: true });
    });
}

/**
 * The lock a sync holds: `renew()` re-acquires it once half the TTL passed
 * since it was taken and answers false for good once another owner has it.
 */
export function createIndexLock(
    locks: ILockRepository,
    key: string,
    owner: string,
    clock: IClock,
): KnowledgeIndexLock & { readonly lost: boolean } {
    let acquiredAt = clock.now().getTime();
    let lost = false;

    return {
        get lost() {
            return lost;
        },
        async renew() {
            if (lost) {
                return false;
            }

            const now = clock.now().getTime();

            if (now - acquiredAt < KNOWLEDGE_LOCK_TTL_MS / 2) {
                return true;
            }

            // owner-guarded: a no-op when the lease expired and another owner took it
            await locks.release(key, owner);

            if (await locks.acquire(key, owner, KNOWLEDGE_LOCK_TTL_MS)) {
                acquiredAt = now;

                return true;
            }

            lost = true;

            return false;
        },
    };
}

/** Whether the record serves the definition's model and chunker (nothing to re-embed). */
export function servesDefinition(record: KnowledgeCollection, definition: ResolvedKnowledgeCollection): boolean {
    return record.generation > 0 &&
        record.model === definition.model &&
        record.chunker === CHUNKER_VERSION;
}

/** Whether a stored document needs no new record: same title, source and metadata. */
export function sameDetails(stored: KnowledgeDocument, input: KnowledgeDocumentInput): boolean {
    return stored.title === input.title &&
        stored.source === input.source &&
        JSON.stringify(stored.metadata) === JSON.stringify(input.metadata);
}
