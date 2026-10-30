/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { Agent, AgentDefinition, ChannelSubscription } from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';

const invalid = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, null, '2'];

function definition(): AgentDefinition {
    return {
        name: 'maintainer',
        instructions: 'Maintain.',
        model: mockModel([]),
    };
}

function subscription(concurrencyMaxRuns?: number | false): ChannelSubscription {
    return {
        channel: 'events',
        id: 'updates',
        options: {},
        concurrencyMaxRuns,
    };
}

describe('agent concurrency configuration', () => {
    it.each([undefined, false, 1, 4] as const)('keeps an agent cap of %s', (concurrencyMaxRuns) => {
        const agent = defineAgent({ ...definition(), concurrencyMaxRuns });
        expect(agent.definition.concurrencyMaxRuns).toBe(concurrencyMaxRuns);
    });

    it.each([undefined, false, 1, 4] as const)('accepts a subscription cap of %s', (concurrencyMaxRuns) => {
        const agent = defineAgent({ ...definition(), channels: [subscription(concurrencyMaxRuns)] });
        expect(agent.definition.channels?.[0]?.concurrencyMaxRuns).toBe(concurrencyMaxRuns);
    });

    it.each(invalid)('rejects an invalid agent cap %s', (value) => {
        const create = () => defineAgent({ ...definition(), concurrencyMaxRuns: value as number });
        expect(create).toThrow(InvalidAgentDefinitionError);
        expect(create).toThrow(/concurrencyMaxRuns/);
    });

    it.each(invalid)('rejects an invalid subscription cap %s', (value) => {
        const create = () => defineAgent({ ...definition(), channels: [subscription(value as number)] });
        expect(create).toThrow(InvalidAgentDefinitionError);
        expect(create).toThrow(/concurrencyMaxRuns/);
    });

    describe.each(['agent', 'subscription'] as const)('hand-built %s caps', (level) => {
        it.each(invalid)('rejects %s at every registration boundary before store access', async (value) => {
            const accesses: PropertyKey[] = [];
            const store = new Proxy(createMemoryStore(), {
                get(target, key, receiver) {
                    const capability = Reflect.get(target, key, receiver);
                    return new Proxy(capability, {
                        get(role, method, roleReceiver) {
                            accesses.push(method);
                            return Reflect.get(role, method, roleReceiver);
                        },
                    });
                },
            });
            const agent: Agent = {
                name: 'maintainer',
                definition: {
                    ...definition(),
                    budget: {},
                    ...(level === 'agent' ?
                        { concurrencyMaxRuns: value as number } :
                        { channels: [subscription(value as number)] }),
                },
            };
            const channels = [{ name: 'events' }];
            const create = () => new Engine({
                store,
                agents: [agent],
                channels,
            });
            expect(create).toThrow(InvalidAgentDefinitionError);
            expect(create).toThrow(/concurrencyMaxRuns/);

            const engine = new Engine({
                store,
                agents: [],
                channels,
            });
            expect(() => engine.checkAgent(agent)).toThrow(InvalidAgentDefinitionError);
            expect(() => engine.checkAgent(agent)).toThrow(/concurrencyMaxRuns/);
            await expect(engine.putAgent(agent, { revision: 'new' })).rejects.toThrow(InvalidAgentDefinitionError);
            await expect(engine.putAgent(agent, { revision: 'new' })).rejects.toThrow(/concurrencyMaxRuns/);
            expect(engine.getAgent('maintainer')).toBeUndefined();
            expect(accesses).toEqual([]);
        });
    });
});
