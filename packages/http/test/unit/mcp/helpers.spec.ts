/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { toJsonSchema } from '../../../src/mcp/helpers.ts';

function plainSchema(jsonSchema?: unknown): StandardSchemaV1 {
    return {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: (value) => ({ value }),
            ...(jsonSchema ? { jsonSchema } : {}),
        },
    } as StandardSchemaV1;
}

describe('toJsonSchema', () => {
    it('converts a schema with a json schema converter, without $schema', () => {
        const schema = toJsonSchema(z.object({ n: z.number() }));

        expect(schema).toMatchObject({ type: 'object', properties: { n: { type: 'number' } } });
        expect(schema).not.toHaveProperty('$schema');
    });

    it('re-roots local refs at the given pointer, leaving data keywords alone', () => {
        const schema = toJsonSchema(plainSchema({
            input: () => ({
                type: 'object',
                properties: {
                    self: { $ref: '#' },
                    node: { $ref: '#/definitions/node' },
                    remote: { $ref: 'https://example.com/schema' },
                    fixed: { const: { $ref: '#' } },
                },
                definitions: { node: { type: 'array', items: { $ref: '#/definitions/node' } } },
            }),
            output: () => ({}),
        }), '#/properties/payload');

        expect(schema).toEqual({
            type: 'object',
            properties: {
                self: { $ref: '#/properties/payload' },
                node: { $ref: '#/properties/payload/definitions/node' },
                remote: { $ref: 'https://example.com/schema' },
                fixed: { const: { $ref: '#' } },
            },
            definitions: { node: { type: 'array', items: { $ref: '#/properties/payload/definitions/node' } } },
        });
    });

    it('is {} without a schema, without a converter, or when the converter throws', () => {
        expect(toJsonSchema(undefined)).toEqual({});
        expect(toJsonSchema(plainSchema())).toEqual({});
        expect(toJsonSchema(plainSchema({
            input: () => {
                throw new Error('unsupported');
            },
            output: () => ({}),
        }))).toEqual({});
    });
});
