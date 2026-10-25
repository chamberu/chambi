/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { EFFECT, InvalidAgentDefinitionError, toolContextSchema } from '@chamvi/core';
import { webTools } from '@chamvi/tool-web';

describe('webTools options', () => {
    it.each([
        ['options that are no object', 'nope'],
        ['a fetch that is no function', { fetch: 'x' }],
        ['a lookup that is no function', { lookup: 1 }],
        ['an allowUrl that is no function', { allowUrl: true }],
        ['a maxBytes that is no positive integer', { maxBytes: 0 }],
        ['a fractional maxBytes', { maxBytes: 1.5 }],
        ['a timeoutMs that is no positive integer', { timeoutMs: -1 }],
        ['a timeoutMs above the timer maximum', { timeoutMs: 2 ** 31 }],
        ['a clock without setTimeout', { clock: { now: () => new Date() } }],
    ])('refuses %s', (_name, options) => {
        expect(() => webTools(options as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('builds the tools without options', () => {
        expect(Object.keys(webTools()).sort()).toEqual(['web_fetch']);
    });

    it('are chamvi tools and not effect tools', () => {
        for (const tool of Object.values(webTools())) {
            expect(tool.contextSchema).toBe(toolContextSchema);
            expect(EFFECT in tool).toBe(false);
        }
    });

    it('marks every result as untrusted web content', () => {
        for (const tool of Object.values(webTools())) {
            expect(tool.description).toMatch(/untrusted/i);
        }
    });
});
