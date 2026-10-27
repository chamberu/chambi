/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    AGENT_CHANNEL_NAME,
    DEFAULT_MAX_HANDOFFS_PER_RUN,
    Engine,
    HANDOFF_SUBSCRIPTION_ID,
    InvalidAgentDefinitionError,
    MAX_HANDOFF_DEPTH,
    agentChannel,
    defineAgent,
    handoff,
} from '@chamvi/core';
import { MemoryStore } from '../../../src/store/index.ts';
import { mockModel } from '../../utils/mock-model.ts';

const agent = () => defineAgent({
    name: 'maintainer',
    instructions: 'You maintain.',
    model: mockModel([]),
    channels: [handoff.on()],
});

describe('handoff.on()', () => {
    it('is subscription handoff of channel agent', () => {
        expect(handoff.on()).toMatchObject({
            channel: 'agent',
            id: 'handoff',
            options: { maxPerRun: 100 },
        });
        expect(AGENT_CHANNEL_NAME).toBe('agent');
        expect(HANDOFF_SUBSCRIPTION_ID).toBe('handoff');
        expect(DEFAULT_MAX_HANDOFFS_PER_RUN).toBe(100);
        expect(MAX_HANDOFF_DEPTH).toBe(1);
    });

    it('keeps the given options and key functions', () => {
        const concurrencyKey = (p: { pr: string }) => p.pr;
        const subscription = handoff.on({ maxPerRun: 3, concurrencyKey });
        expect(subscription.options.maxPerRun).toBe(3);
        expect(subscription.concurrencyKey).toBe(concurrencyKey);
        expect(subscription).not.toHaveProperty('idempotencyKey');
    });

    it.each([0, 1.5, '3', -1])('maxPerRun must be a positive integer (%s)', (value) => {
        expect(() => handoff.on({ maxPerRun: value as number })).toThrow(InvalidAgentDefinitionError);
        expect(() => handoff.on({ maxPerRun: value as number })).toThrow(/maxPerRun/);
    });

    it('an agent subscribing without agentChannel() is refused', () => {
        const store = new MemoryStore();
        expect(() => new Engine({
            store, 
            agents: [agent()], 
            channels: [], 
        })).toThrow(/unknown channel "agent"/);
        expect(() => new Engine({
            store, 
            agents: [agent()], 
            channels: [agentChannel()], 
        })).not.toThrow();
    });

    it('agentChannel() has neither in nor out', () => {
        const channel = agentChannel();
        expect(channel.name).toBe('agent');
        expect(channel.in).toBeUndefined();
        expect(channel.out).toBeUndefined();
        expect(channel.start).toBeUndefined();
    });

    it('a second handoff.on() is refused', () => {
        expect(() => defineAgent({
            name: 'maintainer',
            instructions: 'You maintain.',
            model: mockModel([]),
            channels: [handoff.on(), handoff.on()],
        })).toThrow(InvalidAgentDefinitionError);
    });
});
