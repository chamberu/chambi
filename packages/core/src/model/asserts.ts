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
 * The model an execution runs: an object as is, a string through the
 * resolver (any refusal an InvalidAgentDefinitionError naming the ref).
 * Without a resolver a string is refused, a guard behind the registration
 * check (checkAgentModel).
 */
export function toLanguageModel(
    ref: ModelRef | undefined,
    models: IModelResolver | undefined,
    agent: string,
): LanguageModel {
    if (ref === undefined) {
        throw new InvalidAgentDefinitionError(`Agent "${agent}" has no model and the app sets no default (CHAMVI_MODEL).`);
    }
    if (typeof ref !== 'string') return ref;
    if (!models) {
        throw new InvalidAgentDefinitionError(
            `Agent "${agent}" uses the model string "${ref}", but the engine has no model resolver (EngineOptions.models); pass a LanguageModel object.`,
        );
    }
    try {
        return models.resolve(ref);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new InvalidAgentDefinitionError(`Model "${ref}" could not be resolved: ${message}`);
    }
}
