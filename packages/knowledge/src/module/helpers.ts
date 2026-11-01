/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { knowledgeCollection } from '../collection/module.ts';
import type { KnowledgeCollectionDefinition } from '../collection/types.ts';
import { isKnowledgeRepository } from '../knowledge/helpers.ts';
import type { KnowledgeModuleOptions } from './types.ts';

/**
 * The module options checked when the factory is called
 * (InvalidAgentDefinitionError): every collection definition (also a
 * hand-built one), a name declared twice, the repository's shape and the
 * owner. What needs the app (a string model's resolution, the store) is
 * checked in `setup`.
 */
export function checkModuleOptions(options: KnowledgeModuleOptions | undefined): KnowledgeModuleOptions {
    if (options === undefined) {
        return {};
    }

    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('knowledgeModule() options must be an object.');
    }

    if (options.collections !== undefined && !Array.isArray(options.collections)) {
        throw new InvalidAgentDefinitionError('knowledgeModule() collections must be an array.');
    }

    const names = new Set<string>();
    const definitions: readonly KnowledgeCollectionDefinition[] = options.collections ?? [];

    for (const input of definitions) {
        if (!isObject(input)) {
            throw new InvalidAgentDefinitionError('knowledgeModule() collections must be knowledgeCollection() definitions.');
        }

        const { name } = knowledgeCollection(input.name, input);

        if (names.has(name)) {
            throw new InvalidAgentDefinitionError(`Knowledge collection "${name}" is declared twice.`);
        }

        names.add(name);
    }

    if (options.repository !== undefined && !isKnowledgeRepository(options.repository)) {
        throw new InvalidAgentDefinitionError('knowledgeModule() repository must be a knowledge repository.');
    }

    if (options.owner !== undefined && (typeof options.owner !== 'string' || options.owner.length === 0)) {
        throw new InvalidAgentDefinitionError('knowledgeModule() owner must be a non-empty string.');
    }

    return options;
}
