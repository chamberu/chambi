/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ValidationError, defineTool } from '@chamvi/core';
import { jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { isObject } from 'smob';
import { SKILL_NAME_PATTERN } from './constants.ts';
import type { LoadedSkill, SkillBundle, SkillInput } from './types.ts';

export function createSkillTools(bundles: readonly SkillBundle[]): ToolSet {
    if (!bundles.length) return Object.freeze({});
    const approved = new Map(bundles.map((bundle) => [bundle.metadata.name, bundle]));
    const load = defineTool<SkillInput, LoadedSkill>({
        description: 'Read an approved skill body or one exact supporting reference. References are never followed automatically.',
        inputSchema: jsonSchema<SkillInput>({
            type: 'object',
            properties: {
                name: { type: 'string', pattern: SKILL_NAME_PATTERN.source },
                reference: { type: 'string', description: 'Exact relative POSIX reference path from the approved reference list.' },
            },
            required: ['name'],
            additionalProperties: false,
        }),
        execute: async (input) => {
            if (!isObject(input) || typeof input.name !== 'string' || !SKILL_NAME_PATTERN.test(input.name) ||
                Object.keys(input).some((key) => key !== 'name' && key !== 'reference')) {
                throw new ValidationError('Invalid approved skill request.');
            }
            const bundle = approved.get(input.name);
            if (!bundle) throw new ValidationError('Unknown approved skill.');
            let content = bundle.body;
            const reference = input.reference ?? null;
            if (input.reference !== undefined) {
                if (typeof input.reference !== 'string' || input.reference.includes('\\') || input.reference.includes('\0') ||
                    input.reference.split('/').some((part) => !part || part === '.' || part === '..')) {
                    throw new ValidationError('Invalid approved skill reference.');
                }
                const text = bundle.readReference(input.reference);
                if (text === undefined) throw new ValidationError('Unknown approved skill reference.');
                content = text;
            }
            return {
                name: bundle.metadata.name,
                version: bundle.metadata.version,
                sha256: bundle.metadata.sha256,
                reference,
                content,
                references: [...bundle.references],
            };
        },
    });
    return Object.freeze({ load_skill: Object.freeze(load) });
}
