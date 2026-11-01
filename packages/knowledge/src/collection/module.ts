/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import {
    assertCollectionName,
    isEmbeddingModelObject,
    isKnowledgeSource,
} from './helpers.ts';
import type { KnowledgeCollectionDefinition, KnowledgeCollectionOptions } from './types.ts';

/**
 * Declares a collection: a name (the agent-name rule), the embedding model
 * its chunks are written with and at least one source. `trusted` defaults
 * to true when every source is trusted; an explicit value wins.
 */
export function knowledgeCollection(name: string, options: KnowledgeCollectionOptions): KnowledgeCollectionDefinition {
    assertCollectionName(name, 'knowledgeCollection()');

    const label = `Knowledge collection "${name}"`;

    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError(`${label}: options must be an object.`);
    }

    const {
        model, 
        sources, 
        trusted, 
    } = options;

    if (typeof model === 'string' ? model.length === 0 : !isEmbeddingModelObject(model)) {
        throw new InvalidAgentDefinitionError(
            `${label}: model must be a string '<provider>/<model id>' or an AI SDK embedding model.`,
        );
    }

    if (!Array.isArray(sources) || sources.length === 0) {
        throw new InvalidAgentDefinitionError(`${label}: needs at least one source.`);
    }

    for (const [index, source] of sources.entries()) {
        if (!isKnowledgeSource(source)) {
            throw new InvalidAgentDefinitionError(
                `${label}: source ${index} is no knowledge source (use folder() or defineKnowledgeSource()).`,
            );
        }
    }

    if (trusted !== undefined && typeof trusted !== 'boolean') {
        throw new InvalidAgentDefinitionError(`${label}: trusted must be a boolean.`);
    }

    return {
        name,
        model,
        sources: [...sources],
        trusted: trusted ?? sources.every((source) => source.trusted),
    };
}
