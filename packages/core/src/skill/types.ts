/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import type { Agent, AgentInstructions } from '../agent/types.ts';

export type SkillInput = Readonly<{
    runtime: ISkillRuntimeProvider;
}>;

export interface ISkillRuntimeProvider {
    readonly protocol: string;
    /** Validate and copy inputs synchronously, without I/O or caller mutation. */
    snapshot(inputs: readonly SkillInput[], tools: ToolSet): readonly SkillInput[];
    /** Create fresh per-engine state without I/O. */
    create(globals: readonly SkillInput[]): ISkillRuntime;
}

export interface ISkillRuntime {
    /** Snapshot captured local inputs and validate their composition with globals. */
    checkAgent(agent: Agent, inputs: readonly SkillInput[]): void;
    /** Resolve globals even with no agents; settle all owned work before returning. */
    prepare(agents: readonly Agent[], options: { signal: AbortSignal }): Promise<ISkillPreparation>;
}

export interface ISkillPreparation {
    /** Single use: recheck conflicts and publish all attestations synchronously. */
    commit(): readonly PreparedAgentSkills[];
}

export type PreparedAgentSkills = Readonly<{
    agent: Agent;
    contribution: SkillContribution;
}>;

export type SkillContribution = Readonly<{
    instructions: AgentInstructions;
    tools: ToolSet;
    /** Check ordinary user/state tools before contributed tools are merged. */
    checkTools(tools: ToolSet): void;
}>;
