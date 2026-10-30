/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ValidationError, defineTool  } from '@chamvi/core';
import { jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { isObject } from 'smob';
import { SKILL_NAME_PATTERN } from './constants.ts';
import type { LoadSkillInput, LoadedSkill, Skill } from './types.ts';

export function createSkillTools(bundles: readonly Skill[]): ToolSet {
    if (!bundles.length) {
        return Object.freeze({});
    }

    const approved = new Map(bundles.map((bundle) => [bundle.name, bundle]));
    const load = defineTool<LoadSkillInput, LoadedSkill>({
        description: 'Read an approved skill body or one exact supporting reference. References are never followed automatically.',
        inputSchema: jsonSchema<LoadSkillInput>({
            type: 'object',
            properties: {
                name: { type: 'string', pattern: SKILL_NAME_PATTERN.source },
                reference: { type: 'string', description: 'Exact relative POSIX reference path from the approved reference list.' },
            },
            required: ['name'],
            additionalProperties: false,
        }),
        execute: async (input) => {
            if (!isObject(input)) {
                throw new ValidationError('Invalid approved skill request.');
            }

            if (typeof input.name !== 'string' || !SKILL_NAME_PATTERN.test(input.name)) {
                throw new ValidationError('Invalid approved skill request.');
            }

            const hasUnexpectedKey = Object.keys(input).some((key) => key !== 'name' && key !== 'reference');

            if (hasUnexpectedKey) {
                throw new ValidationError('Invalid approved skill request.');
            }

            const bundle = approved.get(input.name);

            if (!bundle) {
                throw new ValidationError('Unknown approved skill.');
            }

            let content = bundle.body;
            const reference = input.reference ?? null;

            if (input.reference !== undefined) {
                if (typeof input.reference !== 'string') {
                    throw new ValidationError('Invalid approved skill reference.');
                }

                if (input.reference.includes('\\') || input.reference.includes('\0')) {
                    throw new ValidationError('Invalid approved skill reference.');
                }

                const hasInvalidReferenceSegment = input.reference.split('/').some((part) => !part || part === '.' || part === '..');

                if (hasInvalidReferenceSegment) {
                    throw new ValidationError('Invalid approved skill reference.');
                }

                const text = bundle.references[input.reference];

                if (text === undefined) {
                    throw new ValidationError('Unknown approved skill reference.');
                }

                content = text;
            }

            return {
                name: bundle.name,
                version: bundle.version,
                hash: bundle.hash,
                reference,
                content,
                references: Object.keys(bundle.references),
            };
        },
    });

    return Object.freeze({ load_skill: Object.freeze(load) });
}
