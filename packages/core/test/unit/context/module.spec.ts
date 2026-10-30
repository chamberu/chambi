/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    ContextNotProvidedError,
    InvalidAgentDefinitionError,
    defineContextKey,
    inject,
    tryInject,
} from '@chamvi/core';
import type { ToolContext, createMemoryStore } from '@chamvi/core';

function handBuilt(): ToolContext {
    return {
        channels: {} as ToolContext['channels'],
        run: {} as ToolContext['run'],
        state: {} as ToolContext['state'],
        artifacts: {} as ToolContext['artifacts'],
    };
}

describe('context keys', () => {
    it('defineContextKey returns a new key per call', () => {
        const a = defineContextKey<number>('x');
        const b = defineContextKey<number>('x');

        expect(a).not.toBe(b);
        expect(a.name).toBe('x');
        expect(Object.isFrozen(a)).toBe(true);
    });

    it('defineContextKey rejects an empty name', () => {
        expect(() => defineContextKey('')).toThrow(InvalidAgentDefinitionError);
        expect(() => defineContextKey(42 as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('inject on a hand-built ToolContext throws ContextNotProvidedError', () => {
        const key = defineContextKey<ReturnType<typeof createMemoryStore>>('x');
        const ctx = handBuilt();
        let caught: unknown;

        try {
            inject(ctx, key);
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(ContextNotProvidedError);
        expect((caught as ContextNotProvidedError).code).toBe('context_not_provided');
        expect((caught as Error).message).toContain('Context "x"');
        expect(tryInject(ctx, key)).toBeUndefined();
    });
});
