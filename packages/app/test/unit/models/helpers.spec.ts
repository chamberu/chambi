/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { describe, expect, it } from 'vitest';
import {
    assertBaseUrl,
    assertHeaderName,
    describeBaseUrl,
    headerName,
    isPackageNotFound,
    providerEnvName,
    providerName,
    splitModelRef,
} from '../../../src/models/helpers.ts';

function withCode(message: string, code?: string): Error {
    const error = new Error(message);

    if (code) {
        (error as Error & { code: string }).code = code;
    }

    return error;
}

describe('isPackageNotFound', () => {
    it('reads Node\'s missing package', () => {
        const error = withCode('Cannot find package \'@ai-sdk/openai\' imported from /app/x.mjs', 'ERR_MODULE_NOT_FOUND');

        expect(isPackageNotFound(error, '@ai-sdk/openai')).toBe(true);
        expect(isPackageNotFound(error, '@ai-sdk/anthropic')).toBe(false);
    });

    it('reads Vite\'s unresolved import', () => {
        const error = withCode('Could not resolve "@ai-sdk/openai" imported by "@chamvi/app".');

        expect(isPackageNotFound(error, '@ai-sdk/openai')).toBe(true);
    });

    it('a missing file inside the package is no missing package', () => {
        const error = withCode(
            'Cannot find module \'/app/node_modules/@ai-sdk/openai/dist/index.mjs\' imported from /app/x.mjs',
            'ERR_MODULE_NOT_FOUND',
        );

        expect(isPackageNotFound(error, '@ai-sdk/openai')).toBe(false);
    });

    it('other errors are none', () => {
        expect(isPackageNotFound(new SyntaxError('Unexpected token'), '@ai-sdk/openai')).toBe(false);
        expect(isPackageNotFound('Cannot find package \'@ai-sdk/openai\'', '@ai-sdk/openai')).toBe(false);
        expect(isPackageNotFound(withCode('Could not resolve "@ai-sdk/openai"', 'ERR_OTHER'), '@ai-sdk/openai')).toBe(false);
    });
});

describe('provider names', () => {
    it('round trips between provider and env names', () => {
        expect(providerEnvName('team-a')).toBe('TEAM_A');
        expect(providerEnvName('a1')).toBe('A1');
        expect(providerName('TEAM_A')).toBe('team-a');
        expect(providerName('A1')).toBe('a1');
        expect(providerName(providerEnvName('team-a'))).toBe('team-a');
    });

    it('refuses env names that map to no provider name', () => {
        expect(providerName('A__B')).toBeUndefined();
        expect(providerName('_A')).toBeUndefined();
        expect(providerName('A_')).toBeUndefined();
        expect(providerName('Team')).toBeUndefined();
        expect(providerName('')).toBeUndefined();
        expect(providerName('A'.repeat(65))).toBeUndefined();
    });
});

describe('header names', () => {
    it('maps an env suffix to a header name', () => {
        expect(headerName('X_TEAM')).toBe('x-team');
    });

    it('lower-cases a valid header name', () => {
        expect(assertHeaderName('X-Team', 'providers.a.headers')).toBe('x-team');
    });

    it('refuses other header names, naming the field', () => {
        expect(() => assertHeaderName('x_team', 'providers.a.headers')).toThrow(InvalidAgentDefinitionError);
        expect(() => assertHeaderName('x_team', 'providers.a.headers')).toThrow(/providers\.a\.headers/);
        expect(() => assertHeaderName(' x', 'FIELD_X')).toThrow(/FIELD_X/);
        expect(() => assertHeaderName('', 'FIELD_X')).toThrow(/FIELD_X/);
    });
});

describe('splitModelRef', () => {
    it('splits at the first separator', () => {
        expect(splitModelRef('router/cc/claude-opus-4-6')).toEqual({ provider: 'router', model: 'cc/claude-opus-4-6' });
        expect(splitModelRef('anthropic/claude')).toEqual({ provider: 'anthropic', model: 'claude' });
    });

    it('is undefined without provider or model', () => {
        expect(splitModelRef('x')).toBeUndefined();
        expect(splitModelRef('x/')).toBeUndefined();
        expect(splitModelRef('/m')).toBeUndefined();
    });
});

describe('base URLs', () => {
    const message = 'FIELD must be an absolute http(s) URL without credentials, query or fragment.';

    it('accepts absolute http(s) URLs', () => {
        expect(assertBaseUrl('http://9router:20128/v1', 'FIELD')).toBe('http://9router:20128/v1');
        expect(assertBaseUrl('https://api.example.com/v1', 'FIELD')).toBe('https://api.example.com/v1');
    });

    it.each([
        'ftp://h',
        '/v1',
        'http://u:p@h/v1',
        'http://h/v1?k=s',
        'http://h/v1#f',
        'not a url',
    ])('refuses %s without echoing it', (value) => {
        let caught: unknown;

        try {
            assertBaseUrl(value, 'FIELD');
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(InvalidAgentDefinitionError);

        const text = (caught as Error).message;

        expect(text).toBe(message);
        expect(text).not.toContain('u:p');
        expect(text).not.toContain('k=s');
    });

    it('describes a URL as origin plus pathname', () => {
        expect(describeBaseUrl('http://9router:20128/v1')).toBe('http://9router:20128/v1');
        expect(describeBaseUrl('https://api.example.com/')).toBe('https://api.example.com/');
    });
});
