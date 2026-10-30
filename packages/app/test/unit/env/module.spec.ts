/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { describe, expect, it } from 'vitest';
import {
    envBoolean,
    envInteger,
    envJson,
    envList,
    envOneOf,
    envString,
    envUrl,
} from '@chamvi/app';

function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }

    throw new Error('expected a throw');
}

describe('env readers', () => {
    it('treats an empty string as unset', () => {
        const env = { X: '' };

        expect(envString(env, 'X')).toBeUndefined();
        expect(envString(env, 'X', { default: 'd' })).toBe('d');
        expect(envInteger(env, 'X', { default: 3 })).toBe(3);
        expect(envBoolean(env, 'X', { default: true })).toBe(true);
        expect(envUrl(env, 'X', { default: 'https://a.example' })).toBe('https://a.example');
        expect(envList(env, 'X', { default: ['a'] })).toEqual(['a']);
        expect(envJson(env, 'X')).toBeUndefined();
        expect(envOneOf(env, 'X', ['a', 'b'], { default: 'b' })).toBe('b');
    });

    it('envInteger accepts 3000', () => {
        expect(envInteger({ PORT: '3000' }, 'PORT')).toBe(3000);
        expect(envInteger({ PORT: '0' }, 'PORT')).toBe(0);
    });

    it.each(['3000abc', '-1', '1.5', ' 3', '3 ', '0x10', '1e3'])('envInteger rejects %j', (value) => {
        const error = errorOf(() => envInteger({ PORT: value }, 'PORT'));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('PORT');
    });

    it('enforces min and max', () => {
        expect(() => envInteger({ PORT: '70000' }, 'PORT', { max: 65535 })).toThrow(InvalidAgentDefinitionError);
        expect(() => envInteger({ PORT: '0' }, 'PORT', { min: 1 })).toThrow(InvalidAgentDefinitionError);
        expect(envInteger({ PORT: '65535' }, 'PORT', { min: 1, max: 65535 })).toBe(65535);
        expect(errorOf(() => envInteger({ PORT: '70000' }, 'PORT', { max: 65535 })).message)
            .toBe('PORT must be at most 65535.');
        expect(errorOf(() => envInteger({ PORT: '0' }, 'PORT', { min: 1 })).message)
            .toBe('PORT must be at least 1.');
    });

    it('envBoolean accepts true|false|1|0 and rejects yes|t|TRUE', () => {
        expect(envBoolean({ B: 'true' }, 'B')).toBe(true);
        expect(envBoolean({ B: '1' }, 'B')).toBe(true);
        expect(envBoolean({ B: 'false' }, 'B')).toBe(false);
        expect(envBoolean({ B: '0' }, 'B')).toBe(false);

        for (const value of ['yes', 't', 'f', 'TRUE', ' true']) {
            expect(() => envBoolean({ B: value }, 'B')).toThrow(InvalidAgentDefinitionError);
        }
    });

    it('required throws naming the variable', () => {
        const error = errorOf(() => envString({}, 'API_SECRET', { required: true }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('API_SECRET is required.');
        expect(() => envInteger({ N: '' }, 'N', { required: true })).toThrow('N is required.');
        expect(() => envBoolean({}, 'B', { required: true })).toThrow('B is required.');
        expect(() => envUrl({}, 'U', { required: true })).toThrow('U is required.');
        expect(() => envList({}, 'L', { required: true })).toThrow('L is required.');
        expect(() => envJson({}, 'J', { required: true })).toThrow('J is required.');
        expect(() => envOneOf({}, 'O', ['a'], { required: true })).toThrow('O is required.');
    });

    it('envString minLength', () => {
        expect(errorOf(() => envString({ API_SECRET: 'short' }, 'API_SECRET', { minLength: 32 })).message)
            .toBe('API_SECRET must be at least 32 characters.');
        expect(envString({ API_SECRET: 'x'.repeat(32) }, 'API_SECRET', { minLength: 32 })).toBe('x'.repeat(32));
    });

    it('envUrl rejects a relative URL and a ftp: URL when protocols are http(s)', () => {
        const protocols = ['http:', 'https:'];

        expect(() => envUrl({ U: '/relative' }, 'U', { protocols })).toThrow(InvalidAgentDefinitionError);
        expect(() => envUrl({ U: 'ftp://a.example' }, 'U', { protocols })).toThrow(InvalidAgentDefinitionError);
        expect(envUrl({ U: 'https://a.example/base//' }, 'U', { protocols })).toBe('https://a.example/base');
        expect(envUrl({ U: 'ftp://a.example' }, 'U')).toBe('ftp://a.example');
    });

    it('envList splits on commas', () => {
        expect(envList({ L: 'a, b,,c' }, 'L')).toEqual(['a', 'b', 'c']);
    });

    it('envJson parses and rejects malformed JSON', () => {
        expect(envJson({ J: '[1,{"a":2}]' }, 'J')).toEqual([1, { a: 2 }]);

        const error = errorOf(() => envJson({ J: '[1,' }, 'J'));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('J must be valid JSON.');
    });

    it('envOneOf lists the allowed values', () => {
        expect(envOneOf({ L: 'warn' }, 'L', ['error', 'warn'])).toBe('warn');
        expect(errorOf(() => envOneOf({ L: 'verbose' }, 'L', ['error', 'warn'])).message)
            .toBe('L must be one of error, warn.');
    });

    it('never echoes the value', () => {
        const value = 'sekr3t-value-xyz';
        const env = { S: value };
        const readers: Array<() => unknown> = [
            () => envString(env, 'S', { minLength: 64 }),
            () => envInteger(env, 'S'),
            () => envBoolean(env, 'S'),
            () => envUrl(env, 'S'),
            () => envUrl({ S: `ftp://${value}` }, 'S', { protocols: ['https:'] }),
            () => envJson(env, 'S'),
            () => envOneOf(env, 'S', ['a']),
        ];

        for (const read of readers) {
            const error = errorOf(read);

            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(error.message).not.toContain(value);
        }
    });
});
