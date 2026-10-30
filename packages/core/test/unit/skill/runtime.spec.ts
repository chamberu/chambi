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
import { jsonSchema } from 'ai';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { fakeSkillRuntime } from '../../utils/skill-runtime.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { ControllableClock } from '../../utils/clock.ts';

const agent = (input?: ReturnType<typeof fakeSkillRuntime>['input']) => defineAgent({
    name: 'test',
    instructions: 'role',
    skills: input ? [input] : [],
});
const engine = (agents: ReturnType<typeof agent>[] = []) => new Engine({
    store: createMemoryStore(),
    model: mockModel([]),
    agents,
});
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

describe('skill runtime integration', () => {
    it('keeps the old registration, revision and queued run when caller cancellation interrupts a second preparation', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let hold = false;
        const fake = fakeSkillRuntime({
            prepare: async () => {
                if (!hold) {
                    return;
                }

                entered.resolve(); await release.promise;
            },
        });
        const original = agent(fake.input);
        const candidate = agent(fake.input);
        const e = engine();
        try {
            await e.putAgent(original, { revision: 'v1' });
            const { runId } = await e.dispatch({
                agent: 'test',
                channel: 'test',
                trigger: 'test',
                payload: {},
            });
            const marker = await e.store.agentRevisions.findOne('test');
            const run = await e.getRun(runId);
            await e.prepare({ agents: [candidate] });
            const { commits } = fake.calls;
            hold = true;
            const controller = new AbortController();
            const reason = new Error('caller stopped during second preparation');
            const options = { revision: 'v2', signal: controller.signal };
            let settled = false;
            const pending = e.putAgent(candidate, options).catch((error: unknown) => error).finally(() => { settled = true; });
            await entered.promise;
            controller.abort(reason);
            await flush();
            expect(settled).toBe(false);
            release.resolve();
            expect(await pending).toBe(reason);
            expect(fake.calls.commits).toBe(commits);
            expect(e.getAgent('test')).toBe(original);
            expect(e.agentRevision('test')).toBe('v1');
            expect(await e.store.agentRevisions.findOne('test')).toEqual(marker);
            expect(await e.getRun(runId)).toEqual(run);
        } finally {
            release.resolve();
            await e.stop();
        }
    });

    it.each(['caller', 'engine'] as const)('finishes an already-started revision change consistently when %s cancellation arrives', async (cancel) => {
        const clock = new ControllableClock(new Date(1_000));
        const store = createMemoryStore({ clock });
        const original = agent();
        const candidate = agent();
        const e = new Engine({
            clock,
            store,
            agents: [],
            model: mockModel([]),
        });
        const controller = new AbortController();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const save = store.agentRevisions.save.bind(store.agentRevisions);
        let stopping: Promise<void> | undefined;
        try {
            await e.putAgent(original, { revision: 'v1' });
            const { runId } = await e.dispatch({
                agent: 'test',
                channel: 'test',
                trigger: 'test',
                payload: {},
            });
            clock.advance(1);
            vi.spyOn(store.agentRevisions, 'save').mockImplementation(async (revision) => {
                await save(revision);
                entered.resolve();
                await release.promise;
            });
            const options = { revision: 'v2', signal: controller.signal };
            const replacing = e.putAgent(candidate, options);
            const result = replacing.catch((error: unknown) => error);
            await entered.promise;
            if (cancel === 'caller') controller.abort(new Error('caller stopped after registry mutation'));
            else stopping = e.stop();
            release.resolve();
            expect(await result).toBe('replaced');
            expect(e.getAgent('test')).toBe(candidate);
            expect(e.agentRevision('test')).toBe('v2');
            expect(await store.agentRevisions.findOne('test')).toMatchObject({ hash: 'v2' });
            expect(await e.getRun(runId)).toMatchObject({ status: 'cancelled', error: { code: 'agent_replaced' } });
        } finally {
            release.resolve();
            await stopping;
            await e.stop();
            vi.restoreAllMocks();
        }
    });

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
            store: createMemoryStore(),
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
            store: createMemoryStore(),
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
            store: createMemoryStore(),
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
        expect((await e.store.steps.find(run.runId)).find((step) => step.name === 'contributed')?.output).toBe('test');
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
            store: createMemoryStore(),
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
            store: createMemoryStore(),
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
    it.each(['constructor', 'checkAgent', 'prepare'] as const)('keeps captured input descriptors after %s and array/definition replacement', async (capture) => {
        const original = fakeSkillRuntime();
        const replacement = fakeSkillRuntime({ protocol: 'replacement/v2' });
        const input = { runtime: original.runtime };
        const inputs = [input];
        const a = agent(original.input);
        Object.assign(a.definition, { skills: inputs });
        const model = mockModel([{ parts: [{ type: 'text', text: 'original' }] }]);
        const e = new Engine({
            store: createMemoryStore(),
            model,
            agents: capture === 'constructor' ? [a] : [],
        });
        if (capture === 'checkAgent') e.checkAgent(a);
        if (capture === 'prepare') await e.prepare({ agents: [a] });
        input.runtime = replacement.runtime;
        inputs.push(replacement.input);
        Object.assign(a.definition, { skills: [replacement.input] });
        await expect(e.prepare({ agents: [a] })).resolves.toBeUndefined();
        await expect(e.putAgent(a)).resolves.toBe(capture === 'constructor' ? 'unchanged' : 'added');
        await e.start(); await e.stop(); await e.start();
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        await e.idle(); await e.stop();
        expect((await e.getRun(run.runId))?.status).toBe('completed');
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('prepared contribution');
        expect(original.calls.creates).toBe(1); expect(replacement.calls.creates).toBe(0);
    });
    it('retains an empty capture when another candidate selects the first runtime in the same preparation', async () => {
        const empty = agent();
        const original = fakeSkillRuntime();
        const incompatible = fakeSkillRuntime({ protocol: 'mutated/v2' });
        const e = engine([empty]);
        Object.assign(empty.definition, { skills: [incompatible.input] });
        const candidate = defineAgent({
            name: 'late',
            instructions: '',
            skills: [original.input],
        });
        await expect(e.prepare({ agents: [candidate] })).resolves.toBeUndefined();
        await expect(e.start()).resolves.toBeUndefined(); await e.stop();
        expect(original.calls.creates).toBe(1); expect(incompatible.calls.creates).toBe(0);
    });
});
