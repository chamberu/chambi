/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { jsonSchema } from 'ai';
import {
    Engine,
    InvalidAgentDefinitionError,
    MemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { fakeSkillRuntime } from '../../utils/skill-runtime.ts';
import { mockModel } from '../../utils/mock-model.ts';

const agent = (input?: ReturnType<typeof fakeSkillRuntime>['input']) => defineAgent({
    name: 'test',
    instructions: 'role',
    skills: input ? [input] : [],
});
const engine = (agents: ReturnType<typeof agent>[] = []) => new Engine({
    store: new MemoryStore(),
    model: mockModel([]),
    agents,
});
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

describe('skill runtime integration', () => {
    it('snapshots synchronously without creating a runtime, and selects one runtime per engine', async () => {
        const one = fakeSkillRuntime(); const two = fakeSkillRuntime();
        const a = agent(one.input);
        expect(one.calls).toMatchObject({ snapshots: 1, creates: 0 });
        const e = engine([a]);
        e.checkAgent(agent(two.input));
        await e.prepare(); await e.start(); await e.stop(); await e.start(); await e.stop();
        expect(one.calls.creates).toBe(1); expect(two.calls.creates).toBe(0);
    });
    it('rejects incompatible descriptors before preparation or store work', async () => {
        const selected = fakeSkillRuntime(); const incompatible = fakeSkillRuntime({ protocol: 'other/v2' });
        const e = engine([agent(selected.input)]);
        expect(() => e.checkAgent(agent(incompatible.input))).toThrow(InvalidAgentDefinitionError);
        expect(incompatible.calls.prepares).toBe(0);
        await expect(e.putAgent(agent(incompatible.input))).rejects.toThrow(/protocol/i);
        expect(e.getAgent('test')?.definition.skills?.[0]?.runtime).toBe(selected.runtime);
        await e.stop();
    });
    it('does not adopt a first candidate runtime when subsequent synchronous checks fail', () => {
        const bad = fakeSkillRuntime({ protocol: 'bad/v1' }); const good = fakeSkillRuntime(); const e = engine();
        const invalid = defineAgent({
            name: 'bad',
            instructions: '',
            skills: [bad.input],
            channels: [{
                id: 'missing',
                channel: 'missing',
                options: {},
            }],
        });
        expect(() => e.checkAgent(invalid)).toThrow(/unknown channel/i);
        expect(() => e.checkAgent(agent(good.input))).not.toThrow();
        expect(good.calls.creates).toBe(1);
    });
    it('keeps empty captured agents runnable after the first late runtime', async () => {
        const model = mockModel([{ parts: [{ type: 'text', text: 'empty' }] }, { parts: [{ type: 'text', text: 'contributed' }] }]);
        const empty = defineAgent({ name: 'empty', instructions: 'empty role' });
        const e = new Engine({
            store: new MemoryStore(),
            agents: [empty],
            model,
        });
        await e.start(); const fake = fakeSkillRuntime(); await e.putAgent(agent(fake.input));
        for (const name of ['empty', 'test']) { const run = await e.dispatch({
            agent: name,
            channel: 'test',
            trigger: 'test',
            payload: {},
        }); await e.idle(); expect((await e.getRun(run.runId))?.status).toBe('completed'); }
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain('prepared contribution');
        expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('prepared contribution');
        await e.stop();
    });
    it('owns ignored cancellation until actual settlement and never commits canceled work', async () => {
        const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
        const fake = fakeSkillRuntime({ prepare: async () => { entered.resolve(); await release.promise; } });
        const e = engine([agent(fake.input)]); const result = e.prepare().catch((error: unknown) => error); await entered.promise;
        let stopped = false; const stopping = e.stop().then(() => { stopped = true; }); await flush(); expect(stopped).toBe(false);
        release.resolve(); await stopping; expect(await result).toBeInstanceOf(Error); expect(fake.calls.commits).toBe(0);
    });
    it('does not publish a failed commit and retries the captured agent', async () => {
        let fail = true; const fake = fakeSkillRuntime({ commit: () => { if (fail) throw new Error('commit failed'); } }); const e = engine([agent(fake.input)]);
        await expect(e.prepare()).rejects.toThrow('commit failed'); fail = false; await e.prepare();
        expect(fake.calls.prepares).toBe(2); expect(fake.calls.creates).toBe(1); await e.stop();
    });
    it('validates descriptors synchronously without creating a runtime', () => {
        expect(() => defineAgent({
            name: 'test',
            instructions: '',
            skills: [{} as never],
        })).toThrow(/runtime provider/i);
        expect(() => new Engine({
            store: new MemoryStore(),
            agents: [],
            skills: [{
                runtime: {
                    protocol: '',
                    snapshot() {},
                    create() {},
                },
            } as never],
        })).toThrow(/runtime provider/i);
    });
    it('checks resolved ordinary tools and executes contributed tools with the normal context and hooks', async () => {
        const events: string[] = [];
        const contribution = Object.freeze({
            instructions: 'custom contribution',
            tools: Object.freeze({ contributed: defineTool({ inputSchema: jsonSchema({ type: 'object' }), execute: async (_input, { context }) => context.run.agent }) }),
            checkTools: (tools: Record<string, unknown>) => { expect(tools).toHaveProperty('ordinary'); events.push('check'); },
        });
        const fake = fakeSkillRuntime({ contribution });
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'contributed',
                input: {},
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store: new MemoryStore(),
            model,
            agents: [defineAgent({
                name: 'test',
                instructions: 'role',
                skills: [fake.input],
                tools: () => ({ ordinary: defineTool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => null }) }),
                hooks: { beforeToolExecution: () => { events.push('before'); }, afterToolExecution: () => { events.push('after'); } },
            })],
        });
        await e.start();
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        }); await e.idle();
        expect((await e.store.listSteps(run.runId)).find((step) => step.name === 'contributed')?.output).toBe('test');
        expect(events).toEqual(['check', 'before', 'after']);
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('custom contribution');
        await e.stop();
    });
    it('owns the preparation before invoking a callback that initiates stop', async () => {
        const release = Promise.withResolvers<void>(); const entered = Promise.withResolvers<void>();
        let stopping: Promise<void> | undefined; let stopped = false;
        const fake = fakeSkillRuntime({
            prepare: async () => {
                stopping = e.stop().then(() => { stopped = true; });
                entered.resolve();
                await release.promise;
            },
        });
        const e = engine([agent(fake.input)]); const pending = e.prepare().catch((error: unknown) => error);
        await entered.promise; await flush(); expect(stopped).toBe(false);
        release.resolve(); await pending; await stopping;
        expect(stopped).toBe(true); expect(fake.calls.commits).toBe(0);
    });
    it('checks an instruction-only contribution against an empty tool set', async () => {
        let checks = 0;
        const fake = fakeSkillRuntime({
            contribution: {
                instructions: 'extra',
                tools: {},
                checkTools(tools) { expect(tools).toEqual({}); checks++; },
            },
        });
        const model = mockModel([{ parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store: new MemoryStore(),
            model,
            agents: [agent(fake.input)],
        });
        await e.start();
        await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        await e.idle(); await e.stop();
        expect(checks).toBe(1);
    });
    it('does not adopt a runtime whose synchronous composition check rejects', () => {
        const rejected = fakeSkillRuntime({ protocol: 'rejected/v1', check: () => { throw new InvalidAgentDefinitionError('composition rejected'); } });
        const accepted = fakeSkillRuntime();
        const e = engine();
        expect(() => e.checkAgent(agent(rejected.input))).toThrow('composition rejected');
        expect(() => e.checkAgent(agent(accepted.input))).not.toThrow();
        expect(rejected.calls.creates).toBe(1);
        expect(accepted.calls.creates).toBe(1);
    });
    it('checks all descriptor protocols before invoking a snapshot callback', () => {
        const first = fakeSkillRuntime(); const incompatible = fakeSkillRuntime({ protocol: 'other/v2' });
        expect(() => defineAgent({
            name: 'test',
            instructions: '',
            skills: [first.input, incompatible.input],
        })).toThrow(/protocol/i);
        expect(first.calls.snapshots).toBe(0); expect(incompatible.calls.snapshots).toBe(0);
    });
    it('prepares global inputs even when no agents are registered', async () => {
        const fake = fakeSkillRuntime();
        const e = new Engine({
            store: new MemoryStore(),
            agents: [],
            skills: [fake.input],
        });
        await e.prepare();
        expect(fake.calls).toMatchObject({
            creates: 1,
            prepares: 1,
            commits: 1,
        });
        await e.stop();
    });
});
