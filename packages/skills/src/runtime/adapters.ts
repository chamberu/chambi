/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { SkillInput } from '@chamvi/core';
import { copySkill, copySkillSource } from '../catalog/helpers.ts';
import type { ISkillSource, Skill } from '../catalog/types.ts';
import { skillRuntimeProvider } from './provider.ts';

export function defineSkill(value: Skill): Skill & SkillInput {
    return Object.freeze({ ...copySkill(value), runtime: skillRuntimeProvider });
}

export function defineSkillSource(value: ISkillSource): ISkillSource & SkillInput {
    return Object.freeze({ ...copySkillSource(value), runtime: skillRuntimeProvider });
}
