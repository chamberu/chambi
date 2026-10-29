/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEffectTool, wrapToolsForRun } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { currentToolCall } from '../../../src/effect/frame.ts';
import { createMemoryRepositories } from '../../../src/repository/index.ts';

const ctx = { run: { runId: 'r1' } } as unknown as ToolContext;
const schema = z.object({});

async function call(tools: ToolSet, name: string, toolCallId: string): Promise<unknown> {
    const result: unknown = await (tools[name]!.execute as (input: unknown, options: unknown) => unknown)({}, { toolCallId, messages: [] });
    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        const seen: unknown[] = await Array.fromAsync(result as AsyncIterable<unknown>);
        return seen;
    }
    return result;
}

describe('tool-call frame', () => {
    it('is undefined outside a tool call', () => {
        expect(currentToolCall()).toBeUndefined();
    });

    it('holds the call in plain and effect tools, across awaits', async () => {
        const plain = tool({
            inputSchema: schema,
            execute: async () => {
                await Promise.resolve();
                return currentToolCall();
            },
        });
        const effect = defineEffectTool({ inputSchema: schema, execute: async () => currentToolCall() });
        const tools = wrapToolsForRun({ plain, effect }, ctx, createMemoryRepositories().effects);
        expect(await call(tools, 'plain', 'c1')).toMatchObject({
            runId: 'r1',
            toolCallId: 'c1',
            toolName: 'plain',
            approvals: 0,
        });
        expect(await call(tools, 'effect', 'c2')).toMatchObject({
            runId: 'r1',
            toolCallId: 'c2',
            toolName: 'effect',
            approvals: 0,
        });
        expect(currentToolCall()).toBeUndefined();
    });

    it('holds the call while a streaming tool is iterated', async () => {
        const stream = tool({
            inputSchema: schema,
            async* execute() {
                yield currentToolCall()?.toolCallId;
                await Promise.resolve();
                yield currentToolCall()?.toolCallId;
            },
        });
        const tools = wrapToolsForRun({ stream }, ctx, createMemoryRepositories().effects);
        expect(await call(tools, 'stream', 'c3')).toEqual(['c3', 'c3']);
    });
});
