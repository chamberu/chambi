/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { toJsonParameter } from '../../../src/entities/helpers.ts';

describe('toJsonParameter', () => {
    it('hands back the value itself when it needs no sanitising', () => {
        const value = { a: [1, 'x'], b: { c: null } };
        expect(toJsonParameter(value).toJSON()).toBe(value);
    });

    it('replaces NUL characters and lone surrogates with U+FFFD', () => {
        const parameter = toJsonParameter({
            nul: 'a\u0000b', 
            lone: 'x\uD800', 
            pair: '😀', 
        });
        expect(parameter.toJSON()).toEqual({
            nul: 'a�b', 
            lone: 'x�', 
            pair: '😀', 
        });
    });

    it('serialises like JSON.stringify', () => {
        expect(JSON.stringify(toJsonParameter(null))).toBe('null');
        expect(JSON.stringify(toJsonParameter('s'))).toBe('"s"');
        expect(JSON.stringify(toJsonParameter({ a: 'a\u0000' }))).toBe('{"a":"a\uFFFD"}');
    });
});
