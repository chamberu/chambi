/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { EmbeddingModel, LanguageModel } from 'ai';

// #region public

/**
 * A model: `'<provider>/<model id>'` (split at the first `/`, resolved
 * through the engine's IModelResolver) or an AI SDK LanguageModel object,
 * used as is.
 */
export type ModelRef = string | LanguageModel;

/** Turns `'<provider>/<model id>'` strings into LanguageModel (and, optionally, EmbeddingModel) objects. */
export interface IModelResolver {
    /**
     * Refuses a ref that cannot resolve (unknown provider, missing setting)
     * with InvalidAgentDefinitionError; `agent` is undefined for the app's
     * default model.
     */
    check(ref: string, agent?: string): void;
    /** The LanguageModel for `ref`; InvalidAgentDefinitionError when it cannot resolve. */
    resolve(ref: string): LanguageModel;
    /**
     * The EmbeddingModel for `ref` (`'<provider>/<model id>'`), for packages
     * that embed text; InvalidAgentDefinitionError when it cannot resolve.
     * Optional: a resolver without it hands out no embedding models.
     */
    embedding?(ref: string): EmbeddingModel;
}

/** What checkAgentModel() reads besides the agent: the engine's default and resolver. */
export type ModelCheckOptions = {
    model?: ModelRef;
    models?: IModelResolver;
};
// #endregion public

/** What the engine provides under MODEL_CONTEXT (internal). */
export type ModelContext = {
    model?: ModelRef;
    models?: IModelResolver;
    /** The model of the agent registered under `name` now (the live registry). */
    agentModel(name: string): ModelRef | undefined;
};
