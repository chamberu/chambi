/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isSafeExtractionSchema } from '../../../src/extract/schema.ts';

describe('safe extraction schemas', () => {
    it.each([
        { type: 'boolean' },
        { type: 'number' },
        {
            type: 'integer',
            minimum: 0,
            maximum: 10,
        },
        { enum: ['bug', 'feature'] },
        { const: 'fixed by code' },
        {
            type: 'string',
            pattern: '^[a-z]+$',
            maxLength: 200,
        },
        {
            type: 'array',
            maxItems: 10,
            items: { type: 'boolean' },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: { label: { enum: ['bug', 'feature'] }, confidence: { type: 'number' } },
            required: ['label'],
        },
    ])('accepts bounded schema %j', (schema) => {
        expect(isSafeExtractionSchema(schema)).toBe(true);
    });

    it.each([
        true,
        false,
        {},
        { type: 'string' },
        { type: 'string', maxLength: 10 },
        { type: 'string', pattern: '.*' },
        {
            type: 'string',
            pattern: '^.+$',
            maxLength: 201,
        },
        {
            type: 'string',
            pattern: '^.+$',
            maxLength: -1,
        },
        { type: 'array', items: { type: 'boolean' } },
        {
            type: 'array',
            maxItems: 11,
            items: { type: 'boolean' },
        },
        {
            type: 'array',
            maxItems: 1.5,
            items: { type: 'boolean' },
        },
        {
            type: 'array',
            maxItems: 2,
            items: { type: 'string' },
        },
        { type: 'object', properties: {} },
        { type: 'object', additionalProperties: true },
        {
            type: 'object',
            additionalProperties: false,
            properties: { text: { type: 'string' } },
        },
        {
            type: 'object',
            additionalProperties: false,
            patternProperties: { '.*': { type: 'boolean' } },
        },
        { $ref: '#/definitions/safe' },
        { type: 'boolean', $ref: '#/definitions/safe' },
        { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
        { type: ['boolean', 'string'] },
        { const: { text: 'not a scalar' } },
        { enum: [] },
    ])('rejects unsafe or unsupported schema %j', (schema) => {
        expect(isSafeExtractionSchema(schema)).toBe(false);
    });

    it('rejects recursive schemas instead of recursing indefinitely', () => {
        const schema: Record<string, unknown> = { type: 'object', additionalProperties: false };

        schema.properties = { recursive: schema };
        expect(isSafeExtractionSchema(schema)).toBe(false);
    });

    it('checks native Zod schemas after SDK conversion', async () => {
        const safe = z.object({ label: z.enum(['bug', 'feature']), values: z.array(z.boolean()).max(10) });
        const unsafe = z.object({ summary: z.string().max(100) });

        expect(isSafeExtractionSchema(await asSchema(safe).jsonSchema)).toBe(true);
        expect(isSafeExtractionSchema(await asSchema(unsafe).jsonSchema)).toBe(false);
    });
});
