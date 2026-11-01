/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { KnowledgeCollectionDefinition } from '../collection/types.ts';
import type { IKnowledgeRepository } from '../repository/types.ts';

export type KnowledgeModuleOptions = {
    /** The declared collections (`knowledgeCollection()`); string models resolve through the app's providers. */
    collections?: readonly KnowledgeCollectionDefinition[];
    /** Default an in-memory repository (every restart re-embeds; warned outside dev). */
    repository?: IKnowledgeRepository;
    /** The indexer's lock owner; default `${hostname}-${pid}`. */
    owner?: string;
};
