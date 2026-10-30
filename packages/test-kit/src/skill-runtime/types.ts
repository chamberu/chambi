/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent, SkillContribution, SkillInput } from '@chamvi/core';

export type FakeSkillRuntimeOptions = {
    protocol?: string;
    prepare?: (signal: AbortSignal) => Promise<void>;
    check?: (agent: Agent, inputs: readonly SkillInput[]) => void;
    commit?: () => void;
    contribution?: SkillContribution;
};
