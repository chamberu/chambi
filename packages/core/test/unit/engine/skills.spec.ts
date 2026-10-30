/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { defineAgent } from '@chamvi/core';
import { EngineSkills } from '../../../src/engine/skills/module.ts';
import type { IEngineSkills } from '../../../src/engine/skills/types.ts';
import { EMPTY_SKILL_CONTRIBUTION } from '../../../src/skill/constants.ts';
import { fakeSkillRuntime } from '../../utils/skill-runtime.ts';

const agent = (input?: ReturnType<typeof fakeSkillRuntime>['input']) => defineAgent({
    name: 'test',
    instructions: 'role',
    skills: input ? [input] : [],
});
const options = () => ({ signal: new AbortController().signal });
const contribution = Object.freeze({
    instructions: 'prepared contribution',
    tools: {},
    checkTools: () => {},
});

describe('EngineSkills', () => {
    it('snapshots globals synchronously and keeps their selected provider for compatible locals', async () => {
        const global = fakeSkillRuntime({ contribution });
        const local = fakeSkillRuntime();
        const candidate = agent(local.input);
        const inputs = [global.input];
        const create = vi.spyOn(global.runtime, 'create');
        const skills: IEngineSkills = new EngineSkills(inputs);

        expect(global.calls).toMatchObject({
            snapshots: 1,
            creates: 1,
            prepares: 0,
        });
        expect(create).toHaveBeenCalledWith([global.input]);
        expect(create.mock.calls[0]?.[0]).not.toBe(inputs);
        inputs.length = 0;

        skills.checkAgent(candidate);
        await skills.prepare([candidate], options());

        expect(global.calls.creates).toBe(1);
        expect(local.calls.creates).toBe(0);
        expect(skills.get(candidate)).toBe(contribution);
    });

    it('does not select a runtime or capture inputs from a rejected first check', async () => {
        const rejected = fakeSkillRuntime({
            protocol: 'rejected/v1',
            check: () => {
                throw new Error('rejected');
            },
        });
        const accepted = fakeSkillRuntime({ contribution });
        const candidate = agent(rejected.input);
        const skills: IEngineSkills = new EngineSkills();

        expect(() => skills.checkAgent(candidate)).toThrow('rejected');
        expect(skills.get(candidate)).toBeUndefined();
        Object.assign(candidate.definition, { skills: [accepted.input] });
        skills.checkAgent(candidate);
        await skills.prepare([candidate], options());

        expect(rejected.calls.prepares).toBe(0);
        expect(accepted.calls.creates).toBe(1);
        expect(skills.get(candidate)).toBe(contribution);
    });

    it('rechecks earlier empty captures when a later agent selects the first runtime', async () => {
        const checks: { candidate: ReturnType<typeof agent>; inputs: readonly unknown[] }[] = [];
        const fake = fakeSkillRuntime({
            contribution,
            check: (candidate, inputs) => {
                checks.push({ candidate, inputs });
            },
        });
        const incompatible = fakeSkillRuntime({ protocol: 'other/v2' });
        const empty = agent();
        const late = agent(fake.input);
        const skills: IEngineSkills = new EngineSkills();

        skills.checkAgent(empty);
        Object.assign(empty.definition, { skills: [incompatible.input] });
        await skills.prepare([empty, late], options());

        expect(checks.map(({ candidate }) => candidate)).toEqual([late, empty, late]);
        expect(checks[1]?.inputs).toEqual([]);
        expect(checks[0]?.inputs).toBe(checks[2]?.inputs);
        expect(incompatible.calls.creates).toBe(0);
        expect(skills.get(empty)).toBe(contribution);
    });

    it('caches empty contributions by agent identity even after a runtime is selected', async () => {
        const skills: IEngineSkills = new EngineSkills();
        const empty = agent();
        const fake = fakeSkillRuntime({ contribution });
        const replacement = agent(fake.input);

        expect(skills.get(empty)).toBeUndefined();
        await skills.prepare([empty], options());
        expect(skills.get(empty)).toBe(EMPTY_SKILL_CONTRIBUTION);
        expect(skills.get(replacement)).toBeUndefined();

        await skills.prepare([empty, replacement], options());

        expect(skills.get(empty)).toBe(EMPTY_SKILL_CONTRIBUTION);
        expect(skills.get(replacement)).toBe(contribution);
    });

    it('still checks cached agents and prepares globals when there are no unprepared agents', async () => {
        const fake = fakeSkillRuntime({ contribution });
        const candidate = agent(fake.input);
        const skills: IEngineSkills = new EngineSkills([fake.input]);

        await skills.prepare([], options());
        await skills.prepare([candidate], options());

        const { checks } = fake.calls;

        await skills.prepare([candidate], options());

        expect(fake.calls.checks).toBe(checks + 1);
        expect(fake.calls.prepares).toBe(3);
        expect(fake.calls.commits).toBe(3);
        expect(skills.get(candidate)).toBe(contribution);
    });

    it('rejects an already aborted preparation before checking agents', async () => {
        const fake = fakeSkillRuntime({ contribution });
        const candidate = agent(fake.input);
        const skills: IEngineSkills = new EngineSkills([fake.input]);
        const controller = new AbortController();
        const reason = new Error('cancelled');

        controller.abort(reason);
        await expect(skills.prepare([candidate], { signal: controller.signal })).rejects.toBe(reason);

        expect(fake.calls.checks).toBe(0);
        expect(fake.calls.prepares).toBe(0);
        expect(skills.get(candidate)).toBeUndefined();
    });

    it('checks cancellation after runtime preparation and before committing contributions', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        let cancel = true;
        const fake = fakeSkillRuntime({
            contribution,
            prepare: async () => {
                if (cancel) {
                    controller.abort(reason);
                }
            },
        });
        const candidate = agent(fake.input);
        const skills: IEngineSkills = new EngineSkills([fake.input]);

        await expect(skills.prepare([candidate], { signal: controller.signal })).rejects.toBe(reason);
        expect(fake.calls.commits).toBe(0);
        expect(skills.get(candidate)).toBeUndefined();

        cancel = false;
        await skills.prepare([candidate], options());
        expect(fake.calls.commits).toBe(1);
        expect(skills.get(candidate)).toBe(contribution);
    });

    it('does not cache contributions if the runtime commit fails', async () => {
        const fake = fakeSkillRuntime({
            commit: () => {
                throw new Error('conflict');
            },
        });
        const candidate = agent(fake.input);
        const skills: IEngineSkills = new EngineSkills([fake.input]);

        await expect(skills.prepare([candidate], options())).rejects.toThrow('conflict');
        expect(skills.get(candidate)).toBeUndefined();
    });
});
