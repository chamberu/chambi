/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { LanguageModel } from 'ai';
import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    InvalidAgentDefinitionError,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { AgentDefinition, ChannelSubscription } from '@chamvi/core';

const model = {} as LanguageModel;
const base = { model, instructions: 'do things' };

describe('defineAgent', () => {
    it('rejects invalid names', () => {
        for (const name of ['Triage', 'a--b', 'a'.repeat(65), '', '-a', 'a-']) {
            expect(() => defineAgent({ ...base, name })).toThrow(InvalidAgentDefinitionError);
        }
    });

    it('accepts valid names', () => {
        expect(defineAgent({ ...base, name: 'triage-2' }).name).toBe('triage-2');
        expect(() => defineAgent({ ...base, name: 'a'.repeat(64) })).not.toThrow();
    });

    it('applies budget defaults', () => {
        const agent = defineAgent({ ...base, name: 'a' });
        expect(agent.definition.budget.maxSteps).toBe(20);
        expect(agent.definition.budget.timeoutMs).toBe(900_000);
        expect(agent.definition.budget.maxTokens).toBeUndefined();
    });

    it('keeps budget overrides', () => {
        const agent = defineAgent({
            ...base,
            name: 'a',
            budget: { maxSteps: 3, maxTokens: 10 },
        });
        expect(agent.definition.budget).toEqual({
            maxSteps: 3,
            maxTokens: 10,
            timeoutMs: 900_000,
        });
    });

    it('rejects duplicate subscription ids', () => {
        const on = (channel: string, id: string): ChannelSubscription => ({
            channel,
            id,
            options: {},
        });
        expect(() => defineAgent({
            ...base,
            name: 'a',
            channels: [on('cron', 'cron:x'), on('cron', 'cron:x')],
        })).toThrow(/duplicate subscription id "cron:x"/);
        expect(() => defineAgent({
            ...base,
            name: 'a',
            channels: [on('cron', 'cron:x'), on('http', 'http'), on('webhook', 'webhook:/a'), on('webhook', 'webhook:/b')],
        })).not.toThrow();
    });

    it('accepts a subscription typed by its payload', () => {
        const github: ChannelSubscription<{ repo: string }> = {
            channel: 'github',
            id: 'github:issues',
            options: {},
            concurrencyKey: (payload) => payload.repo,
            idempotencyKey: (payload) => `${payload.repo}:1`,
        };
        expectTypeOf(github).toExtend<ChannelSubscription>();
        const agent = defineAgent({
            ...base,
            name: 'a',
            channels: [github],
        });
        expectTypeOf(agent.definition.channels).toEqualTypeOf<AgentDefinition['channels']>();
        expect(agent.definition.channels?.[0]?.concurrencyKey?.({ repo: 'o/r' })).toBe('o/r');
    });

    it('accepts a plain tool set', () => {
        const tools = { lookup: defineTool({ inputSchema: z.object({}), execute: async () => 'ok' }) };
        expect(defineAgent({
            ...base,
            name: 'a',
            tools,
        }).definition.tools).toBe(tools);
    });

    it('keeps toolsContext by reference', () => {
        const entry = { token: 't' };
        const map = { third: entry };
        const third = tool({ inputSchema: z.object({}), execute: async () => 'ok' });
        const agent = defineAgent({
            ...base,
            name: 'a',
            tools: { third },
            toolsContext: map,
        });
        expect(agent.definition.toolsContext).toBe(map);
        expect(agent.definition.toolsContext?.third).toBe(entry);
    });

    it('checks toolsContext only for a plain set', () => {
        expect(() => defineAgent({
            ...base,
            name: 'a',
            tools: () => ({}),
            toolsContext: { missing: {} },
        })).not.toThrow();
    });

    it('agent_opt_in_validated', () => {
        expect(defineAgent({ ...base, name: 'a' }).definition.conversation).toBeUndefined();
        expect(defineAgent({
            ...base,
            name: 'a',
            conversation: false,
        }).definition.conversation).toBe(false);
        expect(defineAgent({
            ...base,
            name: 'a',
            conversation: true,
        }).definition.conversation).toBe(true);
        for (const value of ['true', 1, 0, null, {}, []]) {
            expect(() => defineAgent({
                ...base,
                name: 'a',
                conversation: value as never,
            }), String(value))
                .toThrow(InvalidAgentDefinitionError);
        }
        expectTypeOf<AgentDefinition['conversation']>().toEqualTypeOf<boolean | undefined>();
    });
});
