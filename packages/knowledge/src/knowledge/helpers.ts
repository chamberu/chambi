/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { hostname } from 'node:os';
import type { IModelResolver } from '@chamvi/core';
import { InvalidAgentDefinitionError, systemClock } from '@chamvi/core';
import { isObject } from 'smob';
import { isEmbeddingModelObject, modelIdentity } from '../collection/helpers.ts';
import { knowledgeCollection } from '../collection/module.ts';
import type { KnowledgeCollectionDefinition, ResolvedKnowledgeCollection } from '../collection/types.ts';
import type { IKnowledgeRepository } from '../repository/types.ts';
import type { KnowledgeErrorContext, KnowledgeOptions } from './types.ts';

const REPOSITORY_METHODS: readonly (keyof IKnowledgeRepository)[] = [
    'saveCollection',
    'findOneCollection',
    'findOneCollectionOrFail',
    'findCollections',
    'deleteCollection',
    'saveDocument',
    'findOneDocument',
    'findOneDocumentOrFail',
    'findDocumentIds',
    'deleteDocument',
    'replaceChunks',
    'deleteGeneration',
    'deleteGenerationsExcept',
    'search',
];

type NormalizedOptions = Required<Omit<KnowledgeOptions, 'models'>> & Pick<KnowledgeOptions, 'models'>;

function messageOf(error: unknown): string {
    return Error.isError(error) ? error.message : String(error);
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
    return isObject(value) && methods.every((method) => typeof value[method] === 'function');
}

/** Whether `value` has every method of IKnowledgeRepository. */
export function isKnowledgeRepository(value: unknown): value is IKnowledgeRepository {
    return hasMethods(value, REPOSITORY_METHODS);
}

/** The options checked, with their defaults (InvalidAgentDefinitionError). */
export function normalizeOptions(options: KnowledgeOptions): NormalizedOptions {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('createKnowledge() options must be an object.');
    }

    if (!isKnowledgeRepository(options.repository)) {
        throw new InvalidAgentDefinitionError('createKnowledge() repository must be a knowledge repository.');
    }

    if (!hasMethods(options.locks, ['acquire', 'release'])) {
        throw new InvalidAgentDefinitionError('createKnowledge() locks must have acquire() and release().');
    }

    if (options.collections !== undefined && !Array.isArray(options.collections)) {
        throw new InvalidAgentDefinitionError('createKnowledge() collections must be an array.');
    }

    if (options.models !== undefined && !hasMethods(options.models, ['check', 'resolve'])) {
        throw new InvalidAgentDefinitionError('createKnowledge() models must be a model resolver.');
    }

    const clock = options.clock ?? systemClock;

    if (!hasMethods(clock, ['now', 'setTimeout'])) {
        throw new InvalidAgentDefinitionError('createKnowledge() clock must have now() and setTimeout().');
    }

    if (options.owner !== undefined && (typeof options.owner !== 'string' || options.owner.length === 0)) {
        throw new InvalidAgentDefinitionError('createKnowledge() owner must be a non-empty string.');
    }

    if (options.onError !== undefined && typeof options.onError !== 'function') {
        throw new InvalidAgentDefinitionError('createKnowledge() onError must be a function.');
    }

    const report = options.onError ?? ((error: unknown, context: KnowledgeErrorContext) => {
        // eslint-disable-next-line no-console
        console.error('[chamvi]', error, context);
    });

    return {
        repository: options.repository,
        locks: options.locks,
        collections: options.collections ?? [],
        models: options.models,
        clock,
        owner: options.owner ?? `${hostname()}-${process.pid}`,
        // a throwing onError is contained: it would reject an indexing loop nothing awaits
        onError: (error, context) => {
            try {
                report(error, context);
            } catch (thrown) {
                // eslint-disable-next-line no-console
                console.error('[chamvi]', thrown, context);
            }
        },
    };
}

/**
 * A declared collection with its model resolved: an object as is, a string
 * through `models.embedding()`; every failure an InvalidAgentDefinitionError
 * prefixed with the collection.
 */
export function resolveCollection(input: KnowledgeCollectionDefinition, models?: IModelResolver): ResolvedKnowledgeCollection {
    if (!isObject(input)) {
        throw new InvalidAgentDefinitionError('createKnowledge() collections must be knowledgeCollection() definitions.');
    }

    // a hand-built definition passes the same checks
    const definition = knowledgeCollection(input.name, input);
    const label = `Knowledge collection "${definition.name}"`;
    const { model } = definition;

    if (typeof model !== 'string') {
        return {
            name: definition.name,
            model: modelIdentity(model as Exclude<typeof model, string>),
            embedding: model,
            sources: definition.sources,
            trusted: definition.trusted,
        };
    }

    if (!models) {
        throw new InvalidAgentDefinitionError(`${label}: the model string "${model}" needs a model resolver.`);
    }

    if (typeof models.embedding !== 'function') {
        throw new InvalidAgentDefinitionError(`${label}: the model resolver hands out no embedding models.`);
    }

    let embedding: unknown;

    try {
        embedding = models.embedding(model);
    } catch (error) {
        throw new InvalidAgentDefinitionError(`${label}: ${messageOf(error)}`);
    }

    if (!isEmbeddingModelObject(embedding)) {
        throw new InvalidAgentDefinitionError(`${label}: the model resolver gave no embedding model for "${model}".`);
    }

    return {
        name: definition.name,
        model,
        embedding,
        sources: definition.sources,
        trusted: definition.trusted,
    };
}
