/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, toolContextSchema } from '@chamvi/core';
import { hasToolContext } from '../../../src/tool/helpers.ts';

describe('toolContextSchema', () => {
    it('validate returns the given context by identity', () => {
        const ctx = {
            run: {},
            state: {},
            artifacts: {},
        };
        const result = toolContextSchema['~standard'].validate(ctx);
        expect(result).toEqual({ value: ctx });
        expect((result as { value: unknown }).value).toBe(ctx);
        expect(toolContextSchema['~standard'].vendor).toBe('chamvi');
        expect(toolContextSchema['~standard'].version).toBe(1);
    });

    it('validate rejects a missing context with a message naming both causes', () => {
        for (const v of [undefined, null, 'x', []]) {
            const result = toolContextSchema['~standard'].validate(v) as { issues: Array<{ message: string }> };
            expect(result.issues[0]!.message).toMatch(/another copy of @chamvi\/core, or runs outside a chamvi agent/);
        }
    });
});

describe('defineTool', () => {
    it('sets the marker schema and keeps every other field', () => {
        const execute = async () => 'ok';
        const t = defineTool({
            description: 'd',
            inputSchema: z.object({}),
            execute,
        });
        expect(t.contextSchema).toBe(toolContextSchema);
        expect(t.description).toBe('d');
        expect(t.execute).toBe(execute);
        expect(hasToolContext(t)).toBe(true);
        expect(hasToolContext(tool({ inputSchema: z.object({}), execute }))).toBe(false);
    });

    it('types context and rejects an own contextSchema', () => {
        defineTool({
            inputSchema: z.object({ n: z.number() }),
            execute: async ({ n }, { context }) => `${context.run.runId}:${n}`,
        });
        defineTool({
            inputSchema: z.object({}),
            // @ts-expect-error a defineTool brings chamvi's context schema
            contextSchema: z.object({}),
            execute: async () => 1,
        });
    });
});
