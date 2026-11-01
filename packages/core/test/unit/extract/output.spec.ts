/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { isSafeExtractionOutput } from '../../../src/extract/output.ts';

const object = {
    type: 'object',
    additionalProperties: false,
    properties: { label: { enum: ['bug', 'feature'] }, count: { type: 'number' } },
    required: ['label'],
};
const string = {
    type: 'string',
    pattern: '^[a-z]+$',
    minLength: 2,
    maxLength: 4,
};
const array = {
    type: 'array',
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
    items: { type: 'boolean' },
};
const number = {
    type: 'integer',
    minimum: 0,
    maximum: 10,
    exclusiveMinimum: 0,
    exclusiveMaximum: 10,
    multipleOf: 2,
};

describe('safe extraction output validation', () => {
    it.each([
        [{ enum: ['bug', 'feature'] }, 'bug'],
        [{ const: 'fixed' }, 'fixed'],
        [{ type: 'boolean' }, false],
        [{ type: 'null' }, null],
        [object, { label: 'bug', count: 0 }],
        [object, { label: 'feature' }],
        [string, 'abc'],
        [array, [true, false]],
        [number, 4],
    ])('accepts values inside the advertised schema %j: %j', (schema, value) => {
        expect(isSafeExtractionOutput(schema, value)).toBe(true);
    });

    it.each([
        [0.3, 0.1, true],
        [-0.3, 0.1, true],
        [0, 0.1, true],
        [1e-7, 1e-8, true],
        [3e20, 1e20, true],
        [1e21, 1e20, true],
        [1e20, 1e21, false],
        [5e-324, 5e-324, true],
        [0.31, 0.1, false],
        [0.30000000000000004, 0.1, false],
        [0.3, 0, false],
        [0.3, -0.1, false],
        [0.3, Infinity, false],
    ])('checks decimal multipleOf exactly: %s / %s', (value, multipleOf, expected) => {
        expect(isSafeExtractionOutput({ type: 'number', multipleOf }, value)).toBe(expected);
    });

    it.each([
        [{ enum: ['bug', 'feature'] }, 'secret'],
        [{ const: 'fixed' }, 'secret'],
        [{ type: 'boolean' }, 'false'],
        [{ type: 'null' }, undefined],
        [{ type: 'number' }, NaN],
        [{ type: 'number' }, Infinity],
        [object, {}],
        [object, { label: 'bug', extra: 'secret' }],
        [object, { label: 'secret' }],
        [object, { label: 'bug', count: 'secret' }],
        [object, ['bug']],
        [object, new Date()],
        [object, Object.create({ label: 'bug' })],
        [object, Object.defineProperty({ label: 'bug' }, 'hidden', { value: 'secret' })],
        [object, { label: 'bug', [Symbol('secret')]: 'secret' }],
        [object, {
            get label() {
                return 'bug';
            },
        }],
        [string, 'abcde'],
        [string, 'a'],
        [string, '123'],
        [string, 123],
        [array, []],
        [array, [true, false, true]],
        [array, [true, true]],
        [array, ['secret']],
        [array, new Array(1)],
        [array, Object.assign([true], { secret: 'secret' })],
        [number, -1],
        [number, 0],
        [number, 10],
        [number, 12],
        [number, 3],
        [number, 2.5],
        [{
            type: 'string',
            pattern: '[',
            maxLength: 10,
        }, 'a'],
        [{ type: 'string' }, 'secret'],
        [{
            type: 'string',
            pattern: '^a|b$',
            maxLength: 10,
        }, 'secretb'],
    ])('rejects values outside the advertised schema %j: %j', (schema, value) => {
        expect(isSafeExtractionOutput(schema, value)).toBe(false);
    });

    it('checks nested shapes and structural uniqueness', () => {
        const schema = {
            type: 'array',
            maxItems: 2,
            uniqueItems: true,
            items: object,
        };

        expect(isSafeExtractionOutput(schema, [{ label: 'bug', count: 1 }, { count: 1, label: 'bug' }])).toBe(false);
        expect(isSafeExtractionOutput(schema, [{ label: 'bug' }, { label: 'feature' }])).toBe(true);
    });
});
