/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { normalizeOptions } from './helpers.ts';
import { knowledgeSearchTool } from './search.ts';
import type { KnowledgeToolsOptions } from './types.ts';

/**
 * The knowledge tools: `knowledge_search`, a search by meaning over the
 * named collections. The engine must hold the knowledge
 * (`provideKnowledgeContext`). Options are checked when called
 * (InvalidAgentDefinitionError).
 */
export function knowledgeTools(options: KnowledgeToolsOptions): ToolSet {
    const normalized = normalizeOptions(options);

    return { knowledge_search: knowledgeSearchTool(normalized) };
}
