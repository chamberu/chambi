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
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
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
            store: createMemoryStore(),
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
        const first = candidate([ready()]);
        runtime.checkAgent(first, first.definition.skills ?? []);
        const pending = await runtime.prepare([first], { signal: controller.signal });
        expect(runtime.attestations.size).toBe(0);
        controller.abort();
        expect(() => pending.commit()).toThrow();
        expect(runtime.attestations.size).toBe(0);
        const second = candidate([ready()]);
        runtime.checkAgent(second, second.definition.skills ?? []);
        const successful = await runtime.prepare([second], { signal: new AbortController().signal });
        const contributions = successful.commit();
        expect(runtime.attestations.size).toBe(1);
        expect(Object.isFrozen(contributions)).toBe(true);
        expect(Object.isFrozen(contributions[0]?.contribution)).toBe(true);
        expect(() => successful.commit()).toThrow(/already committed/i);
    });
    it.each(['constructor', 'checkAgent', 'prepare'] as const)('retains real content captured by %s after protocol and body replacement', async (capture) => {
        const original = ready();
        const a = candidate([original]);
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'shared' },
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store: createMemoryStore(),
            model,
            agents: capture === 'constructor' ? [a] : [],
        });
        if (capture === 'checkAgent') e.checkAgent(a);
        if (capture === 'prepare') await e.prepare({ agents: [a] });
        Object.assign(a.definition, {
            skills: [{
                ...original,
                body: 'replacement body',
                runtime: { ...original.runtime, protocol: 'changed/v2' },
            }],
        });
        await expect(e.prepare({ agents: [a] })).resolves.toBeUndefined();
        await e.putAgent(a); await e.start(); await e.stop(); await e.start();
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        await e.idle(); await e.stop();
        expect((await e.store.steps.find(run.runId)).find((step) => step.name === 'load_skill')?.output).toMatchObject({ content: 'content' });
    });
    it('keeps an initially empty Agent scope when the first runtime is selected later in the same prepare pass', async () => {
        const empty = candidate([]);
        const original = ready();
        const model = mockModel([{ parts: [{ type: 'text', text: 'empty' }] }]);
        const e = new Engine({
            store: createMemoryStore(),
            model,
            agents: [empty],
        });
        Object.assign(empty.definition, { skills: [original] });
        const late = defineAgent({
            name: 'late',
            instructions: '',
            skills: [original],
        });
        await e.prepare({ agents: [late] }); await e.start(); await e.stop(); await e.start();
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        await e.idle(); await e.stop();
        expect((await e.getRun(run.runId))?.status).toBe('completed');
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain('approved_skills');
        expect(model.doStreamCalls[0]?.tools ?? []).toEqual([]);
    });

    it('retries corrected inputs on the same Agent after a synchronous composition rejection', () => {
        const original = ready();
        const e = new Engine({
            store: createMemoryStore(),
            model: mockModel([]),
            skills: [original],
            agents: [],
        });
        const a = candidate([defineSkill({ ...original, version: '2' })]);
        expect(() => e.checkAgent(a)).toThrow(/conflicting identity/i);
        Object.assign(a.definition, { skills: [defineSkill({ ...original, name: 'corrected' })] });
        expect(() => e.checkAgent(a)).not.toThrow();
    });
});
