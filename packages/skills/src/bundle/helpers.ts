/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isAbsolute } from 'node:path';
import { isObject } from 'smob';
import {
    isMap,
    isScalar,
    parseDocument,
    visit,
} from 'yaml';
import {
    SKILL_CONTROL_PATTERN,
    SKILL_MAX_BODY_BYTES,
    SKILL_MAX_FRONTMATTER_BYTES,
    SKILL_NAME_PATTERN,
} from './constants.ts';
import type { ApprovedSkill, ParsedSkillDocument } from './types.ts';

export function invalidSkill(source: string, reason: string): never {
    throw new InvalidAgentDefinitionError(`Skill bundle ${source}: ${reason}.`);
}

export function validateSkillDirectory(directory: string): void {
    if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) {
        invalidSkill('.', 'directory must be an absolute operator-supplied path');
    }
}

export function validateApprovedSkill(descriptor: ApprovedSkill): void {
    if (!isObject(descriptor)) {
        invalidSkill('.', 'invalid approved skill name');
    }

    if (typeof descriptor.name !== 'string' || !SKILL_NAME_PATTERN.test(descriptor.name)) {
        invalidSkill('.', 'invalid approved skill name');
    }

    const { version, hash } = descriptor;
    if (typeof version !== 'string' || !version.trim() || version.length > 128) {
        invalidSkill('.', 'version must be an exact release identifier');
    }

    if (SKILL_CONTROL_PATTERN.test(version) || /[\s*^~<>=|]/.test(version)) {
        invalidSkill('.', 'version must be an exact release identifier');
    }

    if (/(?:^|\.)x(?:\.|$)/i.test(version) || /^(latest|main|master|head)$/i.test(version)) {
        invalidSkill('.', 'version must be an exact release identifier');
    }

    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
        invalidSkill('.', 'hash must be a lowercase full digest');
    }

    validateSkillDirectory(descriptor.directory);
}

/** UTF-8 byte ordering matches Unicode code-point ordering, including supplementary characters. */
export function compareSkillPaths(a: string, b: string): number {
    return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
    const opening = /^---\r?\n/.exec(content);
    if (!opening) {
        invalidSkill('SKILL.md', 'initial YAML frontmatter is required');
    }

    const rest = content.slice(opening[0].length);
    const closing = /^---(?:\r?\n|$)/m.exec(rest);
    if (!closing) {
        invalidSkill('SKILL.md', 'frontmatter closing delimiter is required');
    }

    const frontmatter = rest.slice(0, closing.index);
    const body = rest.slice(closing.index + closing[0].length);
    if (Buffer.byteLength(frontmatter) > SKILL_MAX_FRONTMATTER_BYTES) {
        invalidSkill('SKILL.md', 'frontmatter exceeds 4 KiB');
    }

    if (Buffer.byteLength(body) > SKILL_MAX_BODY_BYTES) {
        invalidSkill('SKILL.md', 'body exceeds 64 KiB');
    }

    try {
        const document = parseDocument(frontmatter, {
            uniqueKeys: true,
            stringKeys: false,
            strict: true,
            customTags: [],
            resolveKnownTags: false,
            logLevel: 'silent',
        });
        if (document.errors.length || document.warnings.length || !isMap(document.contents)) {
            invalidSkill('SKILL.md', 'invalid YAML frontmatter');
        }

        visit(document, {
            Alias: () => invalidSkill('SKILL.md', 'YAML aliases are unsupported'),
            Node: (_key, node) => {
                if ('tag' in node && node.tag && !node.tag.startsWith('tag:yaml.org,2002:')) {
                    invalidSkill('SKILL.md', 'custom YAML tags are unsupported');
                }
            },
            Pair: (_key, pair) => {
                if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || SKILL_CONTROL_PATTERN.test(pair.key.value)) {
                    invalidSkill('SKILL.md', 'metadata keys must be strings without control characters');
                }
            },
        });
        const metadata: unknown = document.toJS({ maxAliasCount: 0 });
        if (!isObject(metadata)) {
            invalidSkill('SKILL.md', 'metadata must be a mapping');
        }

        const { name } = metadata;
        const description = typeof metadata.description === 'string' ? metadata.description.trim() : undefined;
        if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) {
            invalidSkill('SKILL.md', 'invalid skill name');
        }

        if (typeof description !== 'string' || !description || description.length > 1024 || SKILL_CONTROL_PATTERN.test(description)) {
            invalidSkill('SKILL.md', 'description must be nonblank text of at most 1024 characters without controls');
        }

        return {
            name,
            description,
            ignoredFields: Object.freeze(Object.keys(metadata).filter((key) => key !== 'name' && key !== 'description').sort(compareSkillPaths)),
            body,
        };
    } catch (error) {
        if (error instanceof InvalidAgentDefinitionError) {
            throw error;
        }

        return invalidSkill('SKILL.md', 'invalid YAML frontmatter');
    }
}
