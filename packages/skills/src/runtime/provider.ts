/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import type { ISkillRuntimeProvider, SkillInput } from '@chamvi/core';
import {
    assertSkillContents,
    assertSkillToolCollision,
    composeSkillIdentities,
    copySkillInputs,
    isSkillSource,
    skillHeaders,
} from '../catalog/helpers.ts';
import { SkillRuntime } from './module.ts';

export const skillRuntimeProvider: ISkillRuntimeProvider = Object.freeze({
    protocol: '@chamvi/skills/runtime-v1',
    snapshot(inputs: readonly SkillInput[], tools: ToolSet) {
        const snapshots = copySkillInputs(inputs);
        const headers = composeSkillIdentities(skillHeaders(snapshots));
        assertSkillContents(snapshots.flatMap((input) => isSkillSource(input) ? [] : [input]));
        assertSkillToolCollision(headers, tools);
        return Object.freeze(snapshots.map((input) => Object.freeze({ ...input, runtime: skillRuntimeProvider })));
    },
    create: (globals: readonly SkillInput[]) => new SkillRuntime(globals),
});
