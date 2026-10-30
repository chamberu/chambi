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
import { SkillRuntime } from '../../../src/runtime/module.ts';
import { skillRuntimeProvider } from '../../../src/runtime/provider.ts';
import type { ISkillRuntimeProvider, SkillInput } from '@chamvi/core';
import type { Skill } from '@chamvi/skills';
import { defineSkill, defineSkillSource } from '@chamvi/skills';
import { mockModel } from '@chamvi/test-kit';

const skill = (overrides: Partial<Skill> = {}): Skill & SkillInput => defineSkill({
    name: 'common',
    version: '1.0.0',
    hash: 'a'.repeat(64),
    description: 'Useful metadata',
    ignoredFields: [],
    body: 'body',
    references: { 'references/a.md': 'reference' },
    ...overrides,
});
const candidate = (skills: Parameters<typeof defineAgent>[0]['skills']) => defineAgent({
    name: 'test',
    instructions: '',
    skills,
});

// Inspect the optional runtime, without reintroducing domain state on core's Engine.
class InspectedRuntime extends SkillRuntime {
    get providerCache() {
        return this.sources;
    }
    get attestations() {
        return this.attestedSkills;
    }
}
function engine() {
    const runtime = new InspectedRuntime([]);
    const provider: ISkillRuntimeProvider = {
        ...skillRuntimeProvider,
        snapshot: (inputs) => inputs,
        create: () => runtime,
    };
    const e = new Engine({
        store: createMemoryStore(),
        agents: [],
        model: mockModel([]),
        skills: [{ ...defineSkillSource({ skills: [], load: async () => [] }), runtime: provider }],
    });

    return Object.assign(e, { providerCache: runtime.providerCache, attestations: runtime.attestations });
}

describe('skill preparation retention', () => {
    it('keeps retired providers weakly and historical contents as bounded fingerprints', async () => {
        const e = engine();

        for (let i = 0; i < 8; i++) {
            const ready = skill({ version: `${i}`, body: 'x'.repeat(64_000) });

            await e.putAgent(candidate([defineSkillSource({ skills: [ready], load: async () => [ready] })]));
        }

        await e.removeAgent('test');
        await e.stop();
        expect({
            registeredAgents: e.listAgents().length,
            cacheType: e.providerCache.constructor.name,
            attestedIdentities: e.attestations.size,
            attestationCharacters: e.attestations.values().toArray().reduce((sum, value) => sum + value.length, 0),
        }).toEqual({
            registeredAgents: 0,
            cacheType: 'WeakMap',
            attestedIdentities: 8,
            attestationCharacters: 512,
        });

        for (const value of e.attestations.values()) {
            expect(value).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    it('reuses a reachable original provider after discarded candidates, agent removal and restart', async () => {
        const e = engine();
        let calls = 0;
        const source = defineSkillSource({
            skills: [skill()],
            load: async () => {
                calls++;

                return [skill()];
            },
        });

        await e.prepare({ agents: [candidate([source])] });
        await e.putAgent(candidate([source]));
        await e.removeAgent('test');
        await e.start();
        await e.stop();
        await e.putAgent(candidate([source]));
        await e.start();
        await e.stop();
        expect(calls).toBe(1);
    });

    it('prepares a new identity without copying or scanning historical attestations', async () => {
        const e = engine();

        await e.prepare({ agents: [candidate([skill()])] });

        const iterator = vi.spyOn(e.attestations, Symbol.iterator);
        const entries = vi.spyOn(e.attestations, 'entries');
        const values = vi.spyOn(e.attestations, 'values');
        const keys = vi.spyOn(e.attestations, 'keys');
        const forEach = vi.spyOn(e.attestations, 'forEach');

        await e.prepare({ agents: [candidate([skill({ version: '2' })])] });
        expect(iterator).not.toHaveBeenCalled();
        expect(entries).not.toHaveBeenCalled();
        expect(values).not.toHaveBeenCalled();
        expect(keys).not.toHaveBeenCalled();
        expect(forEach).not.toHaveBeenCalled();
        expect(e.attestations.size).toBe(2);
        await e.stop();
    });

    it.each<Partial<Skill>>([
        { description: 'different metadata' },
        { ignoredFields: ['model'] },
        { body: 'different body' },
        { references: { 'references/b.md': 'reference' } },
        { references: { 'references/a.md': 'different reference' } },
    ])('rejects historical identity reuse with changed contents: %j', async (overrides) => {
        const e = engine();

        await e.prepare({ agents: [candidate([skill()])] });
        await expect(e.prepare({
            agents: [candidate([defineSkillSource({
                skills: [skill()],
                load: async () => [skill(overrides)],
            })])],
        })).rejects.toThrow(/conflicting content/i);
        await e.stop();
    });

    it('canonicalizes field order before fingerprinting and covers every identity field', async () => {
        const e = engine();

        await e.prepare({
            agents: [candidate([skill({
                ignoredFields: ['model', 'allowed-tools'],
                references: { 'references/b.md': 'b', 'references/a.md': 'a' },
            })])],
        });
        await e.prepare({
            agents: [candidate([defineSkillSource({
                skills: [skill()],
                load: async () => [{
                    references: { 'references/a.md': 'a', 'references/b.md': 'b' },
                    body: 'body',
                    ignoredFields: ['allowed-tools', 'model'],
                    description: 'Useful metadata',
                    hash: 'a'.repeat(64),
                    version: '1.0.0',
                    name: 'common',
                }],
            })])],
        });

        for (const overrides of [{ name: 'other' }, { version: '2' }, { hash: 'b'.repeat(64) }]) {
            await e.prepare({
                agents: [candidate([skill({
                    ignoredFields: ['model', 'allowed-tools'],
                    references: { 'references/b.md': 'b', 'references/a.md': 'a' },
                    ...overrides,
                })])],
            });
        }

        expect(e.attestations.size).toBe(4);
        expect(new Set(e.attestations.values()).size).toBe(4);
        await e.stop();
    });

    it('rechecks concurrent publications and publishes no partial candidate corpus', async () => {
        const e = engine();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<readonly Skill[]>();
        const extra = skill({ name: 'extra' });
        const firstCandidate = candidate([skill()]);
        const slowCandidate = candidate([defineSkillSource({
            skills: [extra],
            load: async () => {
                entered.resolve();

                return release.promise;
            },
        })]);
        const slow = e.prepare({ agents: [firstCandidate, slowCandidate] }).catch((error: unknown) => error);

        await entered.promise;
        await e.prepare({ agents: [candidate([skill({ body: 'published first' })])] });
        release.resolve([extra]);
        expect(await slow).toMatchObject({ message: expect.stringMatching(/conflicting content/i) });
        expect(e.attestations.size).toBe(1);
        await expect(e.prepare({ agents: [firstCandidate] })).rejects.toThrow(/conflicting content/i);
        await e.prepare({ agents: [candidate([skill({ name: 'extra', body: 'fresh extra' })])] });
        await expect(e.prepare({ agents: [slowCandidate] })).rejects.toThrow(/conflicting content/i);
        await e.stop();
    });
});
