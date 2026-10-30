/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { SKILL_CONTROL_PATTERN, SKILL_MAX_BUNDLES, SKILL_NAME_PATTERN } from './constants.ts';
import type {
    ISkillSource,
    RuntimeSkillInput,
    RuntimeSkillSource,
    Skill,
    SkillIdentity,
} from './types.ts';

export function invalidSkill(reason: string): never {
    throw new InvalidAgentDefinitionError(`Invalid skill: ${reason}.`);
}

export function compareSkillPaths(a: string, b: string): number {
    return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export function sameSkill(a: SkillIdentity, b: SkillIdentity): boolean {
    return a.name === b.name && a.version === b.version && a.hash === b.hash;
}

export function copySkillIdentity(value: unknown): SkillIdentity {
    if (!isObject(value) || typeof value.name !== 'string' || !SKILL_NAME_PATTERN.test(value.name)) {
        invalidSkill('invalid name');
    }

    if (typeof value.version !== 'string' || !value.version.isWellFormed() || !value.version.trim() || value.version.length > 128) {
        invalidSkill('version must be an exact release identifier');
    }

    if (SKILL_CONTROL_PATTERN.test(value.version) || /[\s*^~<>=|]/.test(value.version)) {
        invalidSkill('version must be an exact release identifier');
    }

    if (/(?:^|\.)x(?:\.|$)/i.test(value.version) || /^(latest|main|master|head)$/i.test(value.version)) {
        invalidSkill('version must be an exact release identifier');
    }

    if (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) {
        invalidSkill('hash must be a lowercase full digest');
    }

    return Object.freeze({
        name: value.name,
        version: value.version,
        hash: value.hash,
    });
}

export function copySkill(value: unknown): Skill {
    const identity = copySkillIdentity(value);

    if (!isObject(value)) {
        invalidSkill('invalid content');
    }

    if (typeof value.description !== 'string' || !value.description.isWellFormed() || !value.description.trim()) {
        invalidSkill('invalid description');
    }

    if (value.description.length > 1024 || SKILL_CONTROL_PATTERN.test(value.description)) {
        invalidSkill('invalid description');
    }

    if (!Array.isArray(value.ignoredFields)) {
        invalidSkill('invalid ignored fields');
    }

    const hasInvalidIgnoredField = value.ignoredFields.some((field) => typeof field !== 'string' || !field.isWellFormed() || SKILL_CONTROL_PATTERN.test(field));

    if (hasInvalidIgnoredField) {
        invalidSkill('invalid ignored fields');
    }

    if (typeof value.body !== 'string' || !value.body.isWellFormed() || Buffer.byteLength(value.body) > 64 * 1024) {
        invalidSkill('body exceeds 64 KiB or is not text');
    }

    if (value.body.includes('\0')) {
        invalidSkill('body contains NUL');
    }

    if (!isObject(value.references) || Object.keys(value.references).length > 63) {
        invalidSkill('invalid references');
    }

    const references: Record<string, string> = Object.create(null);
    let bytes = Buffer.byteLength(value.body);

    for (const path of Object.keys(value.references).sort(compareSkillPaths)) {
        if (!path.isWellFormed() || path.includes('\\') || SKILL_CONTROL_PATTERN.test(path)) {
            invalidSkill('invalid reference path');
        }

        const segments = path.split('/');

        const hasInvalidSegment = segments.some((part) => !part || part.startsWith('.'));

        if (hasInvalidSegment || path === 'SKILL.md') {
            invalidSkill('invalid reference path');
        }

        const content = value.references[path];

        if (typeof content !== 'string' || !content.isWellFormed() || Buffer.byteLength(content) > 128 * 1024) {
            invalidSkill('reference exceeds 128 KiB or is not text');
        }

        if (content.includes('\0')) {
            invalidSkill('reference contains NUL');
        }

        bytes += Buffer.byteLength(content);
        references[path] = content;
    }

    if (bytes > 1024 * 1024) {
        invalidSkill('bundle exceeds 1 MiB');
    }

    return Object.freeze({
        ...identity,
        description: value.description,
        ignoredFields: Object.freeze([...value.ignoredFields].sort(compareSkillPaths)),
        body: value.body,
        references: Object.freeze(references),
    });
}

export function isSkillSource(value: unknown): value is RuntimeSkillSource {
    return isObject(value) && 'load' in value;
}

export function copySkillSource(input: unknown): RuntimeSkillSource {
    if (!isObject(input) || typeof input.load !== 'function' || !Array.isArray(input.skills)) {
        invalidSkill('invalid source');
    }

    const skills = Object.freeze(input.skills.map(copySkillIdentity));

    composeSkillIdentities(skills);

    const identity = 'sourceIdentity' in input ? input.sourceIdentity : input;

    if (!isObject(identity)) {
        invalidSkill('invalid source identity token');
    }

    // Bound loaders and structural tokens survive copies from another installed package.
    const load: ISkillSource['load'] = input.load.bind(input);

    return Object.freeze({
        skills,
        sourceIdentity: identity,
        load,
    });
}

export function copySkillInputs(inputs: readonly unknown[] = []): readonly RuntimeSkillInput[] {
    if (!Array.isArray(inputs)) {
        invalidSkill('inputs must be an array');
    }

    return Object.freeze(inputs.map((input) => isSkillSource(input) ? copySkillSource(input) : copySkill(input)));
}

export function composeSkillIdentities(skills: readonly SkillIdentity[]): readonly SkillIdentity[] {
    const names = new Map<string, SkillIdentity>();

    for (const skill of skills) {
        const previous = names.get(skill.name);

        if (previous && !sameSkill(previous, skill)) {
            invalidSkill(`conflicting identity for ${skill.name}`);
        }

        names.set(skill.name, skill);
    }

    if (names.size > SKILL_MAX_BUNDLES) {
        invalidSkill('at most 16 skills per agent');
    }

    return names.values().toArray().sort((a, b) => compareSkillPaths(a.name, b.name));
}

export function skillHeaders(inputs: readonly RuntimeSkillInput[]): readonly SkillIdentity[] {
    return inputs.flatMap((input) => isSkillSource(input) ? [...input.skills] : [input]);
}

export function assertSkillToolCollision(headers: readonly SkillIdentity[], tools: Record<string, unknown>): void {
    if (headers.length && 'load_skill' in tools) {
        invalidSkill('load_skill collides with an agent tool');
    }
}

export function assertSkillContents(skills: readonly Skill[]): void {
    const contents = new Map<string, string>();

    for (const skill of skills) {
        const serialized = JSON.stringify(skill);
        const previous = contents.get(skill.name);

        if (previous !== undefined && previous !== serialized) {
            invalidSkill(`conflicting content for ${skill.name}`);
        }

        contents.set(skill.name, serialized);
    }
}

export function assertSkillResultIdentities(headers: readonly SkillIdentity[], skills: readonly Skill[]): void {
    if (headers.length !== skills.length) {
        invalidSkill('source result does not match declared skills');
    }

    for (const header of headers) {
        const hasNoMatchingSkill = skills.every((skill) => !sameSkill(header, skill));

        if (hasNoMatchingSkill) {
            invalidSkill('source result does not match declared skills');
        }
    }

    for (const skill of skills) {
        const hasNoMatchingHeader = headers.every((header) => !sameSkill(header, skill));

        if (hasNoMatchingHeader) {
            invalidSkill('source result does not match declared skills');
        }
    }
}
