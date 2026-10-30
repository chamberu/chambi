/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { isObject } from 'smob';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import type { ISkillRuntimeProvider, SkillInput } from './types.ts';

function isSkillRuntimeProvider(value: unknown): value is ISkillRuntimeProvider {
    return isObject(value) && typeof value.protocol === 'string' && !!value.protocol.trim() &&
        typeof value.snapshot === 'function' && typeof value.create === 'function';
}

export function selectSkillProvider(inputs: readonly SkillInput[], selected?: ISkillRuntimeProvider): ISkillRuntimeProvider | undefined {
    if (!Array.isArray(inputs)) {
        throw new InvalidAgentDefinitionError('Skill inputs must be an array of self-describing runtime values.');
    }

    let provider = selected;

    for (const input of inputs) {
        if (!isObject(input) || !isSkillRuntimeProvider(input.runtime)) {
            throw new InvalidAgentDefinitionError('Skill inputs require a valid runtime provider; use the optional package factory or adapter.');
        }

        if (provider && provider.protocol !== input.runtime.protocol) {
            throw new InvalidAgentDefinitionError(`Incompatible skill runtime protocol "${input.runtime.protocol}"; expected "${provider.protocol}". Use compatible skill package versions.`);
        }

        provider ??= input.runtime;
    }

    return provider;
}

export function snapshotSkillInputs(inputs: readonly SkillInput[] = [], tools: ToolSet = {}): readonly SkillInput[] {
    const provider = selectSkillProvider(inputs);

    return provider ? provider.snapshot(inputs, tools) : Object.freeze([]);
}
