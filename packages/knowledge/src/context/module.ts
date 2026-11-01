/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { inject } from '@chamvi/core';
import type { IContextProvider, StateSchema, ToolContext } from '@chamvi/core';
import type { IKnowledge } from '../knowledge/types.ts';
import { KNOWLEDGE_CONTEXT } from './constants.ts';

/** Provides `knowledge` to every tool, tools factory and effect hook of the engine's runs. */
export function provideKnowledgeContext(provider: IContextProvider, knowledge: IKnowledge): void {
    provider.provide(KNOWLEDGE_CONTEXT, knowledge);
}

/** The knowledge provided on the engine; throws ContextNotProvidedError (naming `knowledge`) without one. */
export function injectKnowledgeContext<S extends StateSchema = StateSchema>(ctx: ToolContext<S>): IKnowledge {
    return inject(ctx, KNOWLEDGE_CONTEXT);
}
