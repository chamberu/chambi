/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, ILockRepository } from '@chamvi/core';
import type { ResolvedKnowledgeCollection } from '../collection/types.ts';
import type { KnowledgeErrorContext } from '../knowledge/types.ts';
import type { IKnowledgeRepository } from '../repository/types.ts';

/** Embeds texts with the model of a stored identity, one vector per text. */
export type KnowledgeEmbed = (model: string, texts: string[], signal: AbortSignal) => Promise<number[][]>;

/** The held store lock of one sync. */
export type KnowledgeIndexLock = {
    /** Whether the lock is still this owner's (re-acquired once half the TTL passed). */
    renew(): Promise<boolean>;
};

export type SyncCollectionInput = {
    definition: ResolvedKnowledgeCollection;
    repository: IKnowledgeRepository;
    embed: KnowledgeEmbed;
    clock: IClock;
    signal: AbortSignal;
    /** Receives a skipped document's problem; the sync goes on. */
    onError: (error: unknown) => void;
    lock: KnowledgeIndexLock;
};

export type CollectionLoopInput = Omit<SyncCollectionInput, 'lock' | 'onError'> & {
    locks: ILockRepository;
    owner: string;
    onError: (error: unknown, context: KnowledgeErrorContext) => void;
};
