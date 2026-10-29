/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    Engine,
    MemoryStore,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { ISkillSource, Skill } from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';

const skill = (name = 'common', body = 'SECRET BODY'): Skill => ({
    name,
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    description: 'Useful <metadata>',
    ignoredFields: [],
    body,
    references: { 'references/a.md': 'reference' },
});
const agent = (skills: Parameters<typeof defineAgent>[0]['skills'] = []) => defineAgent({
    name: 'test',
    instructions: 'role',
    skills,
});
const engine = (skills: ConstructorParameters<typeof Engine>[0]['skills'] = [], agents = [agent()]) => new Engine({
    store: new MemoryStore(),
    agents,
    skills,
    model: mockModel([]),
});
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

describe('first class skills', () => {
    it('deduplicates exact headers and rejects per-agent conflicts and effective limit synchronously', () => {
        expect(() => engine([skill()], [agent([skill()])])).not.toThrow();
        expect(() => engine([skill()], [agent([{ ...skill(), version: '2' }])])).toThrow(/skill/i);
        expect(() => engine(Array.from({ length: 17 }, (_, i) => skill(`skill-${i}`)))).toThrow(/16/);
        expect(() => engine([], [agent([skill()]), defineAgent({
            name: 'other',
            instructions: '',
            skills: [{ ...skill(), version: '2' }],
        })])).not.toThrow();
    });
    it('copies ready contents and headers before caller mutations', async () => {
        const ready = { ...skill(), references: { 'references/a.md': 'reference' } };
        const source = {
            skills: [{
                name: 'extra',
                version: '1',
                sha256: 'b'.repeat(64),
            }],
            load: vi.fn(async () => [{
                ...skill('extra'),
                version: '1',
                sha256: 'b'.repeat(64),
            }]),
        };
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common', reference: 'references/a.md' },
            }],
        }, {
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store: new MemoryStore(),
            model,
            skills: [ready, source],
            agents: [agent()],
        });
        ready.references['references/a.md'] = 'changed';
        ready.body = 'changed';
        source.skills[0]!.name = 'tampered';
        await e.prepare();
        expect(source.load).toHaveBeenCalledOnce();
        await e.start();
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        await e.idle();
        const steps = (await e.store.listSteps(run.runId)).filter((step) => step.kind === 'tool');
        expect(steps[0]?.output).toMatchObject({ content: 'reference' });
        expect(steps[1]?.output).toMatchObject({ content: 'SECRET BODY' });
        await e.stop();
    });
    it('rejects missing, extra and mismatched provider results and retries failed work', async () => {
        for (const results of [[], [skill('extra')], [skill(), skill('extra')]]) {
            const load = vi.fn(async () => results);
            const e = engine([{ skills: [skill()], load }]);
            await expect(e.prepare()).rejects.toThrow(/skill/i);
            await expect(e.prepare()).rejects.toThrow(/skill/i);
            expect(load).toHaveBeenCalledTimes(2);
        }
    });
    it('memoizes shared providers per engine without changing the shared agent', async () => {
        const load = vi.fn(async () => [skill()]);
        const shared = agent([{ skills: [skill()], load }]);
        const a = engine([], [shared]); const b = engine([], [shared]);
        await Promise.all([a.prepare(), a.prepare(), b.prepare()]);
        expect(load).toHaveBeenCalledTimes(2);
        expect(shared.definition.instructions).toBe('role');
        expect(shared.definition.tools).toBeUndefined();
    });
    it('gates queued execution and channels on verification and coalesces start', async () => {
        const deferred = Promise.withResolvers<readonly Skill[]>();
        const entered = Promise.withResolvers<void>();
        const source: ISkillSource = { skills: [skill()], load: async () => { entered.resolve(); return deferred.promise; } };
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const start = vi.fn(); const stop = vi.fn();
        const e = new Engine({
            store: new MemoryStore(),
            agents: [agent()],
            skills: [source],
            model,
            channels: [{
                name: 'test',
                start,
                stop,
            }],
        });
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        const starts = [e.start(), e.start()];
        await entered.promise;
        expect(start).not.toHaveBeenCalled();
        expect(model.doStreamCalls).toHaveLength(0);
        deferred.resolve([skill()]);
        await Promise.all(starts); await e.idle();
        expect(start).toHaveBeenCalledOnce();
        const instructions = JSON.stringify(model.doStreamCalls[0]?.prompt);
        expect(instructions).toContain('approved_skills');
        expect(instructions).not.toContain('SECRET BODY');
        expect(instructions).toContain('\\\\u003c');
        expect((await e.store.listSteps(run.runId)).find((step) => step.name === 'load_skill')?.output).toMatchObject({ content: 'SECRET BODY', references: ['references/a.md'] });
        await e.stop();
    });
    it('stop joins ignored provider cancellation and allows a deliberate restart', async () => {
        const deferred = Promise.withResolvers<readonly Skill[]>();
        const entered = Promise.withResolvers<void>();
        let signal: AbortSignal | undefined;
        const load = vi.fn(async (options: { signal: AbortSignal }) => { signal = options.signal; entered.resolve(); return deferred.promise; });
        const e = engine([{ skills: [skill()], load }]);
        const starting = e.start().catch((error: unknown) => error);
        await entered.promise;
        let stopped = false;
        const stopping = e.stop().then(() => { stopped = true; });
        await flush();
        expect(signal?.aborted).toBe(true); expect(stopped).toBe(false);
        deferred.resolve([skill()]);
        await stopping; await starting;
        await e.start(); await e.stop();
        expect(load).toHaveBeenCalledTimes(2);
    });
    it('stop owns and stops a channel that resolves late', async () => {
        const entered = Promise.withResolvers<void>(); const deferred = Promise.withResolvers<void>();
        const stop = vi.fn();
        const e = new Engine({
            store: new MemoryStore(),
            agents: [agent()],
            model: mockModel([]),
            channels: [{
                name: 'late',
                start: async () => { entered.resolve(); await deferred.promise; },
                stop,
            }],
        });
        const starting = e.start().catch((error: unknown) => error); await entered.promise;
        let stopped = false; const stopping = e.stop().then(() => { stopped = true; }); await flush(); expect(stopped).toBe(false);
        deferred.resolve(); await starting; await stopping; expect(stop).toHaveBeenCalledOnce();
    });
    it('failed replacement prepares before revision writes or cancellation', async () => {
        const old = agent(); const e = engine([], [old]);
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        const candidate = agent([{ skills: [skill()], load: async () => [] }]);
        await expect(e.putAgent(candidate, { revision: 'new' })).rejects.toThrow(/skill/i);
        expect(e.getAgent('test')).toBe(old);
        expect(await e.store.getAgentRevision('test')).toBeUndefined();
        expect((await e.getRun(run.runId))?.status).toBe('queued');
    });
    it('cleans started channels on rejection without joining its own startup', async () => {
        const stop = vi.fn();
        const e = new Engine({
            store: new MemoryStore(),
            agents: [agent()],
            model: mockModel([]),
            channels: [{
                name: 'one',
                start: async () => {},
                stop,
            }, { name: 'two', start: async () => { throw new Error('channel failed'); } }],
        });
        await expect(e.start()).rejects.toThrow('channel failed'); expect(stop).toHaveBeenCalledOnce(); await e.stop();
    });
    it('rejects static and factory load_skill collisions', async () => {
        expect(() => agent([skill()]) && engine([skill()], [defineAgent({
            name: 'test',
            instructions: '',
            tools: { load_skill: defineTool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => null }) },
        })])).toThrow(/load_skill/);
        const model = mockModel([{ parts: [{ type: 'text', text: 'must not run' }] }]);
        const e = new Engine({
            store: new MemoryStore(),
            agents: [defineAgent({
                name: 'test',
                instructions: '',
                tools: () => ({ load_skill: defineTool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => null }) }),
                skills: [skill()],
            })],
            model,
        });
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });
        await e.start(); await e.idle(); expect((await e.getRun(run.runId))?.status).toBe('failed'); expect(model.doStreamCalls).toHaveLength(0); await e.stop();
    });
    it('a concurrent start caller can cancel the shared attempt with its original reason', async () => {
        const deferred = Promise.withResolvers<readonly Skill[]>(); const entered = Promise.withResolvers<void>();
        const e = engine([{ skills: [skill()], load: async () => { entered.resolve(); return deferred.promise; } }]);
        const one = e.start().catch((error: unknown) => error); await entered.promise;
        const controller = new AbortController(); const reason = new Error('caller cancelled');
        const two = e.start({ signal: controller.signal }).catch((error: unknown) => error);
        controller.abort(reason); deferred.resolve([skill()]);
        expect(await one).toBe(reason); expect(await two).toBe(reason); await e.stop();
    });
    it('rejects conflicting content under the same identity from otherwise isolated providers', async () => {
        const a = agent([{ skills: [skill()], load: async () => [skill()] }]);
        const b = defineAgent({
            name: 'other',
            instructions: '',
            skills: [{ skills: [skill()], load: async () => [skill('common', 'different content')] }],
        });
        const e = engine([], [a, b]);
        await expect(e.prepare()).rejects.toThrow(/conflicting content/i);
        await e.stop();
    });
    it('loads a repeated original source once across globals and separate agent snapshots', async () => {
        const load = vi.fn(async () => [skill()]); const source = { skills: [skill()], load };
        const e = engine([source], [agent([source]), defineAgent({
            name: 'other',
            instructions: '',
            skills: [source],
        })]);
        await Promise.all([e.prepare(), e.start()]); expect(load).toHaveBeenCalledOnce(); await e.stop();
    });
    it('stop joins standalone candidate preparation even when its provider ignores abort', async () => {
        const entered = Promise.withResolvers<void>(); const deferred = Promise.withResolvers<readonly Skill[]>();
        const e = engine();
        const candidate = agent([{ skills: [skill()], load: async () => { entered.resolve(); return deferred.promise; } }]);
        const preparing = e.prepare({ agents: [candidate] }).catch((error: unknown) => error);
        await entered.promise; let stopped = false; const stopping = e.stop().then(() => { stopped = true; });
        await flush(); expect(stopped).toBe(false); deferred.resolve([skill()]); await stopping;
        expect(await preparing).toBeInstanceOf(Error);
    });
    it('keeps the captured corpus with a captured agent across replacement during a revision read', async () => {
        const store = new MemoryStore();
        const entered = Promise.withResolvers<void>(); const deferred = Promise.withResolvers<void>();
        const original = store.getAgentRevision.bind(store); let hold = false;
        store.getAgentRevision = async (name) => { if (hold) { hold = false; entered.resolve(); await deferred.promise; } return original(name); };
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store,
            agents: [],
            model,
        });
        await e.putAgent(agent([skill('common', 'OLD')]), { revision: 'same' }); await e.start();
        hold = true;
        const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        }); await entered.promise;
        await e.putAgent(agent([{ ...skill('common', 'NEW'), sha256: 'b'.repeat(64) }]), { revision: 'same' }); deferred.resolve(); await e.idle();
        expect((await store.listSteps(run.runId)).find((step) => step.name === 'load_skill')?.output).toMatchObject({ content: 'OLD' }); await e.stop();
    });
    it('scopes global and extra loads and keeps instructions passive for agents with no user tools', async () => {
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'private' },
            }],
        }, {
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store: new MemoryStore(),
            model,
            skills: [skill()],
            agents: [agent(), defineAgent({
                name: 'other',
                instructions: '',
                skills: [skill('private')],
            })],
        });
        await e.start(); const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        }); await e.idle();
        const calls = (await e.store.listSteps(run.runId)).filter((step) => step.kind === 'tool');
        expect(calls[0]?.error).toMatchObject({ message: 'Unknown approved skill.' }); expect(calls[1]?.output).toMatchObject({ name: 'common' });
        expect(JSON.stringify(model.doStreamCalls[0]?.tools)).not.toContain('private'); await e.stop();
    });
    it('runs load_skill through hooks and durable approval replay with a new prepared snapshot', async () => {
        const store = new MemoryStore(); const before: string[] = []; const after: unknown[] = [];
        const hooks = {
            beforeToolExecution: async (call: { toolName: string }, ctx: Parameters<typeof approve>[0]) => { before.push(call.toolName); await approve(ctx, { title: 'Read approved content?' }); },
            afterToolExecution: (call: { output: unknown }) => { after.push(call.output); },
        };
        const first = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        }]);
        const a = new Engine({
            store,
            model: first,
            agents: [defineAgent({
                name: 'test',
                instructions: '',
                skills: [skill('common', 'OLD')],
                hooks,
            })],
        });
        await a.start(); const run = await a.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        }); await a.idle();
        const waiting = await a.getRun(run.runId); expect(waiting?.status).toBe('waiting'); await a.stop();
        const second = mockModel([{ parts: [{ type: 'text', text: 'done' }] }]);
        const b = new Engine({
            store,
            model: second,
            agents: [defineAgent({
                name: 'test',
                instructions: '',
                skills: [skill('common', 'NEW')],
                hooks,
            })],
        });
        await b.start(); await b.approve(run.runId, { approvalId: waiting!.waiting!.approvalId, approved: true }); await b.idle();
        expect((await b.getRun(run.runId))?.status).toBe('completed'); expect(before).toEqual(['load_skill', 'load_skill']);
        expect(after).toMatchObject([{ content: 'NEW' }]);
        expect(JSON.stringify(second.doStreamCalls[0]?.prompt)).toContain('NEW'); await b.stop();
    });
    it('filters load_skill through the existing policy', async () => {
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        }, { parts: [{ type: 'text', text: 'done' }] }]);
        const e = new Engine({
            store: new MemoryStore(),
            model,
            agents: [defineAgent({
                name: 'test',
                instructions: '',
                skills: [skill()],
                toolPolicy: () => false,
            })],
        });
        await e.start(); const run = await e.dispatch({
            agent: 'test',
            channel: 'test',
            trigger: 'test',
            payload: {},
        }); await e.idle();
        expect((await e.store.listSteps(run.runId)).find((step) => step.kind === 'tool')?.error).toMatchObject({ code: 'tool_not_allowed' }); await e.stop();
    });
    it('rejects conflicting ready snapshots synchronously and rejects malformed UTF-8 strings', () => {
        expect(() => agent([skill(), skill('common', 'DIFFERENT')])).toThrow(/conflicting content/i);
        expect(() => engine([skill(), skill('common', 'DIFFERENT')], [])).toThrow(/conflicting content/i);
        expect(() => engine([skill()], [agent([skill('common', 'DIFFERENT')])])).toThrow(/conflicting content/i);
        expect(() => agent([skill('common', '\ud800')])).toThrow(/skill/i);
        expect(() => agent([{ ...skill(), references: { 'bad.txt': '\ud800' } }])).toThrow(/skill/i);
    });
    it('verification rejects before recovery, channels or a model call', async () => {
        const store = new MemoryStore(); const reads = vi.spyOn(store, 'listRuns'); const start = vi.fn();
        const error = new Error('verification failed'); const model = mockModel([]);
        const e = new Engine({
            store,
            model,
            agents: [agent()],
            channels: [{ name: 'test', start }],
            skills: [{ skills: [skill()], load: async () => { throw error; } }],
        });
        await expect(e.start()).rejects.toBe(error);
        expect(reads).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(model.doStreamCalls).toHaveLength(0);
        await e.stop();
    });
    it('drain joins canceled preparation before it completes', async () => {
        const entered = Promise.withResolvers<void>(); const deferred = Promise.withResolvers<readonly Skill[]>();
        const e = engine([{ skills: [skill()], load: async () => { entered.resolve(); return deferred.promise; } }]);
        const preparing = e.prepare().catch((error: unknown) => error); await entered.promise;
        let drained = false; const draining = e.drain().then(() => { drained = true; }); await flush(); expect(drained).toBe(false);
        deferred.resolve([skill()]); await preparing; await draining;
        expect(e.isDraining).toBe(true);
    });
});
