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
import { Engine, MemoryStore, defineAgent } from '@chamvi/core';
import { defineSkill, defineSkillSource } from '@chamvi/skills';
import { mockModel } from '@chamvi/test-kit';
import { SkillRuntime } from '../../../src/runtime/module.ts';

const ready = () => defineSkill({
    name: 'shared',
    version: '1',
    hash: 'a'.repeat(64),
    description: 'Shared skill',
    ignoredFields: [],
    body: 'content',
    references: {},
});
const candidate = (inputs: Parameters<typeof defineAgent>[0]['skills']) => defineAgent({
    name: 'test',
    instructions: '',
    skills: inputs,
});

class InspectedRuntime extends SkillRuntime {
    get attestations() { return this.attestedSkills; }
}

describe('runtime structural interchange', () => {
    it('accepts a separate module copy with the same protocol and shares original source identity and receiver', async () => {
        const original = ready(); let calls = 0;
        const raw = { skills: [original], async load() { expect(this).toBe(raw); calls++; return [original]; } };
        const one = defineSkillSource(raw);
        vi.resetModules();
        const other = await import('@chamvi/skills');
        const two = other.defineSkillSource(raw);
        expect(one.runtime).not.toBe(two.runtime);
        expect(one.runtime.protocol).toBe(two.runtime.protocol);
        raw.load = async () => { throw new Error('changed loader must not run'); };
        const e = new Engine({
            store: new MemoryStore(),
            model: mockModel([]),
            skills: [one],
            agents: [candidate([two, other.defineSkill(original)])],
        });
        await Promise.all([e.prepare(), e.prepare()]);
        await e.stop(); await e.start(); await e.stop();
        expect(calls).toBe(1);
    });
    it('validates same-protocol payloads structurally before any source loads', () => {
        const { runtime } = ready();
        const load = vi.fn(async () => []);
        expect(() => candidate([{
            runtime,
            load,
            skills: [],
            sourceIdentity: 1,
        } as never])).toThrow(/identity/i);
        expect(() => candidate([{
            runtime,
            name: 'valid',
            body: 'body',
        } as never])).toThrow(/skill/i);
        expect(load).not.toHaveBeenCalled();
    });
    it('stages attestations until commit, rejects cancellation and prevents transaction reuse', async () => {
        const runtime = new InspectedRuntime([]);
        const controller = new AbortController();
        const pending = await runtime.prepare([candidate([ready()])], { signal: controller.signal });
        expect(runtime.attestations.size).toBe(0);
        controller.abort();
        expect(() => pending.commit()).toThrow();
        expect(runtime.attestations.size).toBe(0);
        const successful = await runtime.prepare([candidate([ready()])], { signal: new AbortController().signal });
        const contributions = successful.commit();
        expect(runtime.attestations.size).toBe(1);
        expect(Object.isFrozen(contributions)).toBe(true);
        expect(Object.isFrozen(contributions[0]?.contribution)).toBe(true);
        expect(() => successful.commit()).toThrow(/already committed/i);
    });
});
