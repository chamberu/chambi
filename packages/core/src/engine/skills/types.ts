/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent } from '../../agent/types.ts';
import type { SkillContribution } from '../../skill/types.ts';

export interface IEngineSkills {
    /** `commit: false` validates only: no runtime is selected and no input captured. */
    checkAgent(agent: Agent, options?: { commit?: boolean }): void;
    prepare(agents: readonly Agent[], options: { signal: AbortSignal }): Promise<void>;
    get(agent: Agent): SkillContribution | undefined;
}
