/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import { describe, expect, it } from 'vitest';
import { Engine, defineAgent, systemClock } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { createMemoryRepositories } from '../../../src/repository/index.ts';

const model = {} as LanguageModel;
const triage = defineAgent({
    name: 'triage',
    model,
    instructions: 'x',
});
const digest = defineAgent({
    name: 'digest',
    model,
    instructions: 'x',
});

describe('engine accessors', () => {
    it('exposes the store and clock it was built with', () => {
        const clock = new ControllableClock();
        const store = createMemoryRepositories({ clock });
        const engine = new Engine({
            repositories: store,
            agents: [triage],
            clock,
        });
        expect(engine.repositories).toBe(store);
        expect(engine.clock).toBe(clock);
    });

    it('defaults the clock to systemClock', () => {
        const engine = new Engine({
            repositories: createMemoryRepositories(),
            agents: [],
        });
        expect(engine.clock).toBe(systemClock);
    });

    it('lists its agents in registration order', () => {
        const engine = new Engine({
            repositories: createMemoryRepositories(),
            agents: [triage, digest],
        });
        expect(engine.listAgents()).toEqual([triage, digest]);
        expect(engine.listAgents()[0]).toBe(triage);
    });

    it('returns a fresh array from listAgents', () => {
        const engine = new Engine({
            repositories: createMemoryRepositories(),
            agents: [triage],
        });
        const agents = engine.listAgents();
        agents.push(digest);
        expect(engine.listAgents()).toEqual([triage]);
        expect(engine.getAgent('digest')).toBeUndefined();
    });

    it('looks an agent up by name', () => {
        const engine = new Engine({
            repositories: createMemoryRepositories(),
            agents: [triage, digest],
        });
        expect(engine.getAgent('digest')).toBe(digest);
        expect(engine.getAgent('unknown')).toBeUndefined();
    });
});
