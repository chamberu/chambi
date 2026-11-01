/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent } from '../../agent/types.ts';
import { EMPTY_SKILL_CONTRIBUTION } from '../../skill/constants.ts';
import { selectSkillProvider, snapshotSkillInputs } from '../../skill/helpers.ts';
import type {
    ISkillRuntime,
    ISkillRuntimeProvider,
    SkillContribution,
    SkillInput,
} from '../../skill/types.ts';
import type { IEngineSkills } from './types.ts';

export class EngineSkills implements IEngineSkills {
    protected readonly skills: readonly SkillInput[];

    protected skillProvider?: ISkillRuntimeProvider;

    protected skillRuntime?: ISkillRuntime;

    protected readonly agentSkillInputs = new WeakMap<Agent, readonly SkillInput[]>();

    protected readonly preparedSkills = new WeakMap<Agent, SkillContribution>();

    constructor(inputs: readonly SkillInput[] = []) {
        this.skills = snapshotSkillInputs(inputs);
        this.skillProvider = selectSkillProvider(this.skills);
        this.skillRuntime = this.skillProvider?.create(this.skills);
    }

    /**
     * Validates the agent's skill inputs against the engine's runtime (or the
     * first one they would select). With `commit` (default) the inputs are
     * captured once per agent and a first runtime is kept; a check-only call
     * (`commit: false`) changes nothing.
     */
    checkAgent(agent: Agent, { commit = true }: { commit?: boolean } = {}): void {
        const captured = this.agentSkillInputs.get(agent);
        const supplied = captured ?? agent.definition.skills ?? [];
        const provider = selectSkillProvider(supplied, this.skillProvider);
        const tools = typeof agent.definition.tools === 'function' ? {} : agent.definition.tools ?? {};
        const inputs = captured ?? provider?.snapshot(supplied, tools) ?? Object.freeze([]);
        const runtime = this.skillRuntime ?? provider?.create(this.skills);

        runtime?.checkAgent(agent, inputs);

        if (!commit) {
            return;
        }

        // A rejected candidate must neither select the first runtime nor capture failed inputs.
        if (!captured) {
            this.agentSkillInputs.set(agent, inputs);
        }

        this.skillProvider = provider;
        this.skillRuntime = runtime;
    }

    async prepare(agents: readonly Agent[], { signal }: { signal: AbortSignal }): Promise<void> {
        signal.throwIfAborted();

        const runtimeBeforeChecks = this.skillRuntime;

        for (const agent of agents) {
            this.checkAgent(agent);
        }

        // A first runtime selected late in the pass must also receive earlier empty captures.
        if (this.skillRuntime !== runtimeBeforeChecks) {
            for (const agent of agents) {
                this.checkAgent(agent);
            }
        }

        const unprepared = agents.filter((agent) => !this.preparedSkills.has(agent));

        if (this.skillRuntime) {
            const pending = await this.skillRuntime.prepare(unprepared, { signal });

            signal.throwIfAborted();

            const prepared = pending.commit();

            for (const { agent, contribution } of prepared) {
                this.preparedSkills.set(agent, contribution);
            }
        } else {
            signal.throwIfAborted();

            for (const agent of unprepared) {
                this.preparedSkills.set(agent, EMPTY_SKILL_CONTRIBUTION);
            }
        }
    }

    get(agent: Agent): SkillContribution | undefined {
        return this.preparedSkills.get(agent);
    }
}
