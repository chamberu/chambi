/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import type { IModelResolver, ModelRef } from './types.ts';

/**
 * The refusal for an agent without a model when the engine has no default.
 */
export function noModelMessage(agent: string): string {
    return `Agent "${agent}" has no model and the engine sets no default (EngineOptions.model; CHAMVI_MODEL in @chamvi/app).`;
}

/**
 * The model an execution runs: an object as is, a string through the
 * resolver (any refusal an InvalidAgentDefinitionError naming the ref).
 * Without a resolver a string goes to the AI SDK unchanged (its global
 * default provider).
 */
export function toLanguageModel(
    ref: ModelRef | undefined,
    models: IModelResolver | undefined,
    agent: string,
): LanguageModel {
    if (ref === undefined) {
        throw new InvalidAgentDefinitionError(noModelMessage(agent));
    }
    if (typeof ref !== 'string' || !models) return ref;
    try {
        return models.resolve(ref);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new InvalidAgentDefinitionError(`Model "${ref}" could not be resolved: ${message}`);
    }
}
