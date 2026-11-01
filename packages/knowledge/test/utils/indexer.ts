/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ILockRepository, IModelResolver } from '@chamvi/core';
import { createMemoryStore } from '@chamvi/core';
import { ControllableClock, mockEmbeddingModel } from '@chamvi/test-kit';
import type { EmbeddingModel } from 'ai';
import { MockEmbeddingModelV4 } from 'ai/test';
import { vi } from 'vitest';
import type {
    IKnowledgeRepository,
    IKnowledgeSource,
    KnowledgeCollection,
    KnowledgeOptions,
    MemoryKnowledgeRepository,
} from '@chamvi/knowledge';
import { createMemoryKnowledgeRepository, defineKnowledgeSource } from '@chamvi/knowledge';

/** A custom source over a mutable map of id -> content (title = id). */
export function mapSource(documents: Map<string, string>): IKnowledgeSource {
    return defineKnowledgeSource({
        async* documents() {
            for (const [id, content] of documents) {
                yield {
                    id, 
                    content, 
                    title: id, 
                };
            }
        },
    });
}

/** A model resolver handing out the given embedding models by string ref. */
export function embeddingResolver(models: Record<string, EmbeddingModel>): IModelResolver {
    return {
        check: () => {},
        resolve: () => {
            throw new Error('no language models');
        },
        embedding: (ref) => {
            const model = models[ref];

            if (!model) {
                throw new Error(`unknown embedding model ${ref}`);
            }

            return model;
        },
    };
}

export type RecordedLocks = ILockRepository & {
    /** Every acquire with its owner and result, in call order. */
    readonly acquired: Array<{
        key: string; 
        owner: string; 
        result: boolean 
    }>;
};

/** Locks over a memory lock repository, recording every acquire. */
export function recordingLocks(locks: ILockRepository): RecordedLocks {
    const acquired: RecordedLocks['acquired'] = [];

    return {
        acquired,
        async acquire(key, owner, ttlMs) {
            const result = await locks.acquire(key, owner, ttlMs);

            acquired.push({
                key, 
                owner, 
                result, 
            });

            return result;
        },
        release: (key, owner) => locks.release(key, owner),
    };
}

export type IndexerSetup = {
    clock: ControllableClock;
    repository: MemoryKnowledgeRepository;
    locks: RecordedLocks;
    errors: Array<{ error: unknown; collection?: string }>;
    options(extra?: Partial<KnowledgeOptions>): KnowledgeOptions;
};

export function createIndexerSetup(): IndexerSetup {
    const clock = new ControllableClock(new Date('2026-11-01T00:00:00Z'));
    const repository = createMemoryKnowledgeRepository();
    const locks = recordingLocks(createMemoryStore({ clock }).locks);
    const errors: IndexerSetup['errors'] = [];

    return {
        clock,
        repository,
        locks,
        errors,
        options: (extra = {}) => ({
            repository,
            locks,
            clock,
            onError: (error, context) => {
                errors.push({ error, ...context });
            },
            ...extra,
        }),
    };
}

/** Waits until the stored collection fits `predicate`, returning it. */
export async function waitForCollection(
    repository: Pick<IKnowledgeRepository, 'findOneCollection'>,
    name: string,
    predicate: (collection: KnowledgeCollection) => boolean,
): Promise<KnowledgeCollection> {
    let found: KnowledgeCollection | undefined;

    await vi.waitFor(async () => {
        found = await repository.findOneCollection(name);

        if (!found || !predicate(found)) {
            throw new Error(`collection ${name} is ${found?.status ?? 'missing'}`);
        }
    });

    return found!;
}

/** Waits until the collection is ready at the given generation. */
export function waitForReady(
    repository: Pick<IKnowledgeRepository, 'findOneCollection'>,
    name: string,
    generation = 1,
): Promise<KnowledgeCollection> {
    return waitForCollection(
        repository,
        name,
        (collection) => collection.status === 'ready' && collection.generation === generation,
    );
}

export type GatedModel = MockEmbeddingModelV4 & {
    /** Embedding calls started, in order. */
    readonly started: string[][];
    /** Lets the `n`-th call (0-based) through; calls block until opened. */
    open(n: number): void;
};

/**
 * An embedding model whose calls block until opened, rejecting with the
 * abort reason when aborted meanwhile; vectors come from mockEmbeddingModel().
 */
export function gatedModel(options: { modelId?: string; opened?: number } = {}): GatedModel {
    const inner = mockEmbeddingModel();
    const started: string[][] = [];
    const gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
    let opened = options.opened ?? 0;

    const gate = (n: number) => {
        while (gates.length <= n) {
            const entry = Promise.withResolvers<void>();

            gates.push({ promise: entry.promise, resolve: entry.resolve });
        }

        return gates[n]!;
    };

    const model = new MockEmbeddingModelV4({
        modelId: options.modelId ?? 'gated',
        maxEmbeddingsPerCall: null,
        supportsParallelCalls: true,
        doEmbed: async (call) => {
            const n = started.length;

            started.push([...call.values]);

            if (n >= opened) {
                await new Promise<void>((resolve, reject) => {
                    call.abortSignal?.addEventListener('abort', () => reject(call.abortSignal!.reason), { once: true });
                    gate(n).promise.then(resolve, reject);
                });
            }

            return inner.doEmbed(call);
        },
    });

    return Object.assign(model, {
        started,
        open: (n: number) => {
            opened = Math.max(opened, n + 1);
            gate(n).resolve();
        },
    });
}
