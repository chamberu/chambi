/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { EmbeddingModel } from 'ai';
import { isObject } from 'smob';
import type { IKnowledgeSource } from '../source/types.ts';

/** The agent-name rule. */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX_LENGTH = 64;

/** An AI SDK embedding model object (the string form is a ref, resolved elsewhere). */
type EmbeddingModelObject = Exclude<EmbeddingModel, string>;

export function isCollectionName(value: unknown): value is string {
    return typeof value === 'string' && value.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(value);
}

/** InvalidAgentDefinitionError unless `name` follows the agent-name rule; `label` prefixes the message. */
export function assertCollectionName(name: unknown, label: string): asserts name is string {
    if (isCollectionName(name)) {
        return;
    }

    const shown = typeof name === 'string' ? `"${name.slice(0, NAME_MAX_LENGTH + 1)}"` : String(name);

    throw new InvalidAgentDefinitionError(
        `${label}: the collection name ${shown} must match ${NAME_PATTERN} and be at most ${NAME_MAX_LENGTH} characters.`,
    );
}

export function isEmbeddingModelObject(value: unknown): value is EmbeddingModelObject {
    return isObject(value) &&
        typeof value.provider === 'string' &&
        typeof value.modelId === 'string' &&
        typeof value.doEmbed === 'function';
}

/** The identity stored with a collection's chunks: `<provider>/<model id>`. */
export function modelIdentity(model: EmbeddingModelObject): string {
    return `${model.provider}/${model.modelId}`;
}

export function isKnowledgeSource(value: unknown): value is IKnowledgeSource {
    return isObject(value) &&
        typeof value.kind === 'string' &&
        typeof value.trusted === 'boolean' &&
        typeof value.documents === 'function';
}

/** A declared collection whose name the store holds as a managed one (the boot check and the indexer). */
export function managedNameError(name: string): InvalidAgentDefinitionError {
    return new InvalidAgentDefinitionError(`Knowledge collection "${name}" is managed in the store; a declared collection cannot take its name.`);
}
