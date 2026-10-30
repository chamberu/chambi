/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { SkillContribution } from './types.ts';

export const EMPTY_SKILL_CONTRIBUTION: SkillContribution = Object.freeze({
    instructions: Object.freeze([]),
    tools: Object.freeze({}),
    checkTools: () => {},
});
