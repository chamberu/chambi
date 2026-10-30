/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import type { SkillInput } from '@chamvi/core';
import type { ISkillSource, Skill } from '@chamvi/skills';
import type { LanguageModel } from 'ai';

// The same provider and ready snapshots also work without an app.
export function createReviewEngine(model: LanguageModel, common: ISkillSource & SkillInput, securityExtra: Skill & SkillInput): Engine {
    return new Engine({
        store: createMemoryStore(),
        model,
        skills: [common],
        agents: [defineAgent({
            name: 'security',
            instructions: 'Audit only the operator-approved scope.',
            skills: [securityExtra],
        })],
    });
}
