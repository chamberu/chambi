/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import type {
    Agent,
    ISkillPreparation,
    ISkillRuntime,
    PreparedAgentSkills,
    SkillInput,
} from '@chamvi/core';
import {
    assertSkillContents,
    assertSkillResultIdentities,
    assertSkillToolCollision,
    composeSkillIdentities,
    copySkill,
    copySkillInputs,
    invalidSkill,
    isSkillSource,
    skillHeaders,
} from '../catalog/helpers.ts';
import { createSkillCatalog } from '../catalog/module.ts';
import type { RuntimeSkillInput, RuntimeSkillSource, Skill } from '../catalog/types.ts';

export class SkillRuntime implements ISkillRuntime {
    protected readonly globals: readonly RuntimeSkillInput[];

    protected readonly sources = new WeakMap<object, Promise<readonly Skill[]>>();

    protected readonly agentSkills = new WeakMap<Agent, readonly RuntimeSkillInput[]>();

    protected readonly attestedSkills = new Map<string, string>();

    constructor(globals: readonly SkillInput[]) {
        this.globals = copySkillInputs(globals);
    }

    checkAgent(agent: Agent): void {
        let extras = this.agentSkills.get(agent);
        if (!extras) {
            extras = copySkillInputs(agent.definition.skills);
            this.agentSkills.set(agent, extras);
        }
        const inputs = [...this.globals, ...extras];
        const headers = composeSkillIdentities(skillHeaders(inputs));
        assertSkillContents(inputs.flatMap((input) => isSkillSource(input) ? [] : [input]));
        assertSkillToolCollision(headers, typeof agent.definition.tools === 'function' ? {} : agent.definition.tools ?? {});
    }

    protected resolveSource(source: RuntimeSkillSource, signal: AbortSignal): Promise<readonly Skill[]> {
        const key = source.sourceIdentity;
        let pending = this.sources.get(key);
        if (!pending) {
            pending = (async () => {
                signal.throwIfAborted();
                const result = await source.load({ signal });
                signal.throwIfAborted();
                if (!Array.isArray(result) || result.length !== source.skills.length) {
                    invalidSkill('source result does not match declared skills');
                }
                const skills = Object.freeze(result.map(copySkill));
                assertSkillResultIdentities(source.skills, skills);
                createSkillCatalog(skills);
                return skills;
            })();
            this.sources.set(key, pending);
            const owned = pending;
            void pending.catch(() => {
                if (this.sources.get(key) === owned) this.sources.delete(key);
            });
        }
        return pending.then((skills) => {
            signal.throwIfAborted();
            assertSkillResultIdentities(source.skills, skills);
            return skills;
        });
    }

    async prepare(agents: readonly Agent[], { signal }: { signal: AbortSignal }): Promise<ISkillPreparation> {
        signal.throwIfAborted();
        const resolved: PreparedAgentSkills[] = [];
        const attested = new Map<string, string>();
        const attest = (skills: readonly Skill[]) => {
            for (const skill of skills) {
                const key = JSON.stringify([skill.name, skill.version, skill.hash]);
                const fingerprint = createHash('sha256').update(JSON.stringify(skill)).digest('hex');
                const previous = attested.get(key) ?? this.attestedSkills.get(key);
                if (previous !== undefined && previous !== fingerprint) invalidSkill(`conflicting content for ${skill.name}`);
                attested.set(key, fingerprint);
            }
        };
        const globals: Skill[] = [];
        for (const input of this.globals) {
            globals.push(...(isSkillSource(input) ? await this.resolveSource(input, signal) : [input]));
        }
        attest(globals);
        for (const agent of agents) {
            this.checkAgent(agent);
            const skills = [...globals];
            for (const input of this.agentSkills.get(agent) ?? []) {
                skills.push(...(isSkillSource(input) ? await this.resolveSource(input, signal) : [input]));
            }
            attest(skills);
            const catalog = createSkillCatalog(skills);
            const contribution = Object.freeze({
                instructions: catalog.instructions,
                tools: catalog.tools,
                checkTools: (tools: typeof catalog.tools) => assertSkillToolCollision(catalog.skills, tools),
            });
            resolved.push(Object.freeze({ agent, contribution }));
        }
        signal.throwIfAborted();
        let committed = false;
        return Object.freeze({
            commit: () => {
                if (committed) invalidSkill('preparation was already committed');
                committed = true;
                signal.throwIfAborted();
                // Only staged keys are checked against the live ledger, without copying history.
                for (const [key, fingerprint] of attested) {
                    const previous = this.attestedSkills.get(key);
                    if (previous !== undefined && previous !== fingerprint) invalidSkill('conflicting content from concurrent preparation');
                }
                for (const [key, fingerprint] of attested) this.attestedSkills.set(key, fingerprint);
                return Object.freeze(resolved);
            },
        });
    }
}
