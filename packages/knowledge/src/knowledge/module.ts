/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, ILockRepository, IModelResolver } from '@chamvi/core';
import { ChamviError, InvalidAgentDefinitionError } from '@chamvi/core';
import type { EmbeddingModel } from 'ai';
import { embedMany } from 'ai';
import { isEmbeddingModelObject, managedNameError } from '../collection/helpers.ts';
import type { ResolvedKnowledgeCollection } from '../collection/types.ts';
import { KNOWLEDGE_EMBED_TIMEOUT_MS, KNOWLEDGE_REQUEST_ERROR_CODE } from '../indexer/constants.ts';
import { messageOf } from '../indexer/helpers.ts';
import { markOrphans, runCollection } from '../indexer/module.ts';
import type { IKnowledgeRepository } from '../repository/types.ts';
import { normalizeOptions, resolveCollection } from './helpers.ts';
import type { IKnowledge, KnowledgeErrorContext, KnowledgeOptions } from './types.ts';

class Knowledge implements IKnowledge {
    readonly repository: IKnowledgeRepository;

    protected readonly locks: ILockRepository;

    protected readonly models: IModelResolver | undefined;

    protected readonly clock: IClock;

    protected readonly owner: string;

    protected readonly onError: (error: unknown, context: KnowledgeErrorContext) => void;

    /** The declared collections by name, in declaration order. */
    protected readonly collections = new Map<string, ResolvedKnowledgeCollection>();

    /** The embedding models by stored identity (the first collection's for a shared one). */
    protected readonly embeddings = new Map<string, EmbeddingModel>();

    /** The indexing in flight: its abort and its tasks (one loop per collection, the orphan pass). */
    protected indexing: { controller: AbortController; tasks: Promise<void>[] } | undefined;

    /** The stop still waiting for its tasks; a start() meanwhile waits for it. */
    protected stopping: Promise<void> | undefined;

    /** Whether a start() waits for `stopping`. */
    protected restart = false;

    constructor(options: KnowledgeOptions) {
        const normalized = normalizeOptions(options);

        this.repository = normalized.repository;
        this.locks = normalized.locks;
        this.models = normalized.models;
        this.clock = normalized.clock;
        this.owner = normalized.owner;
        this.onError = normalized.onError;

        for (const definition of normalized.collections) {
            const resolved = resolveCollection(definition, this.models);

            if (this.collections.has(resolved.name)) {
                throw new InvalidAgentDefinitionError(`Knowledge collection "${resolved.name}" is declared twice.`);
            }

            this.collections.set(resolved.name, resolved);

            if (!this.embeddings.has(resolved.model)) {
                this.embeddings.set(resolved.model, resolved.embedding);
            }
        }
    }

    collection(name: string): ResolvedKnowledgeCollection | undefined {
        return this.collections.get(name);
    }

    embedding(model: string): EmbeddingModel {
        const known = this.embeddings.get(model);

        if (known) {
            return known;
        }

        if (typeof this.models?.embedding === 'function') {
            const resolved = this.models.embedding(model);

            if (isEmbeddingModelObject(resolved)) {
                return resolved;
            }
        }

        throw new InvalidAgentDefinitionError(`Knowledge has no embedding model "${model}".`);
    }

    start(): void {
        if (this.indexing || this.restart) {
            return;
        }

        const { stopping } = this;

        if (stopping) {
            // a restart waits for the loops still stopping, so two task sets never overlap
            this.restart = true;
            stopping.then(() => {
                if (!this.restart) {
                    return;
                }

                this.restart = false;
                this.begin();
            }, () => {});

            return;
        }

        this.begin();
    }

    protected begin(): void {
        if (this.indexing) {
            return;
        }

        const controller = new AbortController();
        const { signal } = controller;
        const tasks = [
            markOrphans(this.repository, new Set(this.collections.keys()), this.locks, this.owner, this.clock)
                .catch((error: unknown) => this.onError(error, {})),
            ...this.collections.values().map((definition) => runCollection({
                definition,
                repository: this.repository,
                locks: this.locks,
                owner: this.owner,
                clock: this.clock,
                signal,
                embed: (model, texts, abortSignal) => this.embed(model, texts, abortSignal),
                onError: this.onError,
            })),
        ];

        this.indexing = { controller, tasks };
    }

    async stop(): Promise<void> {
        // a restart still waiting for an earlier stop is dropped
        this.restart = false;

        const { indexing } = this;

        if (!indexing) {
            await this.stopping;

            return;
        }

        this.indexing = undefined;
        indexing.controller.abort();

        const stopping = Promise.allSettled(indexing.tasks).then(() => {});

        this.stopping = stopping;

        try {
            await stopping;
        } finally {
            if (this.stopping === stopping) {
                this.stopping = undefined;
            }
        }
    }

    /**
     * One `embedMany` call; retries are the indexer's backoff on the clock,
     * never the AI SDK's. Given up after KNOWLEDGE_EMBED_TIMEOUT_MS on the
     * clock (aborted, and not awaited further for a provider that ignores
     * the abort), so a stalled request is a reported, retried failure.
     */
    protected async embed(model: string, texts: string[], signal: AbortSignal): Promise<number[][]> {
        const embedding = this.embedding(model);
        const timeout = new AbortController();
        const timer = this.clock.setTimeout(() => timeout.abort(new ChamviError({
            message: `The embedding model did not answer within ${KNOWLEDGE_EMBED_TIMEOUT_MS}ms.`,
            code: KNOWLEDGE_REQUEST_ERROR_CODE,
        })), KNOWLEDGE_EMBED_TIMEOUT_MS);
        const combined = AbortSignal.any([signal, timeout.signal]);
        let cleanup = () => {};
        const aborted = new Promise<never>((_, reject) => {
            const onAbort = () => reject(combined.reason);

            combined.addEventListener('abort', onAbort, { once: true });
            cleanup = () => combined.removeEventListener('abort', onAbort);
        });

        try {
            const { embeddings } = await Promise.race([
                embedMany({
                    model: embedding,
                    values: texts,
                    abortSignal: combined,
                    maxRetries: 0,
                }),
                aborted,
            ]);

            return embeddings;
        } finally {
            cleanup();
            timer.clear();
        }
    }

    async check(): Promise<void> {
        for (const definition of this.collections.values()) {
            for (const source of definition.sources) {
                try {
                    await source.check?.();
                } catch (error) {
                    throw new InvalidAgentDefinitionError(`Knowledge collection "${definition.name}": ${messageOf(error)}`);
                }
            }

            const record = await this.repository.findOneCollection(definition.name);

            if (record?.kind === 'managed') {
                throw managedNameError(definition.name);
            }
        }
    }
}

/**
 * The declared collections over a knowledge repository. Every option is
 * checked here (InvalidAgentDefinitionError): duplicate names, a string
 * model without a resolver (or one that hands out no embedding model or
 * refuses the ref). `start()` indexes every declared collection in the
 * background (one loop each, under the store lock `knowledge:<name>`) and
 * marks declared records without a definition orphaned; `stop()` aborts and
 * awaits both (a `start()` meanwhile begins once they settled). `check()` only reads: it runs every source's `check()` (a
 * missing folder) and refuses a declared name the store holds as a managed
 * collection.
 */
export function createKnowledge(options: KnowledgeOptions): IKnowledge {
    return new Knowledge(options);
}
