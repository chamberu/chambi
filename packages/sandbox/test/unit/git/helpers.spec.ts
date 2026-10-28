/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@chamvi/core';
import { credentialKey, credentialsFileContent } from '../../../src/git/helpers.ts';

describe('urlRepoPath of a malformed escape', () => {
    it('throws a ValidationError, not a URIError', () => {
        expect(() => credentialKey('https://gitlab.com/o/%zz.git')).toThrow(ValidationError);
    });
});

describe('credentialKey', () => {
    it('keys a repository by origin and path without .git, the host by its origin', () => {
        expect(credentialKey('https://github.com/octo/demo.git')).toBe('https://github.com/octo/demo');
        expect(credentialKey('https://git.example.com:8443/a/b/')).toBe('https://git.example.com:8443/a/b');
        expect(credentialKey('https://github.com/')).toBe('https://github.com/');
    });

    it('writes one tab separated line per entry', () => {
        expect(credentialsFileContent([
            {
                key: 'https://github.com/octo/demo',
                username: 'x-access-token',
                password: 'p1',
            },
            {
                key: 'https://github.com/',
                username: 'u',
                password: 'p2',
            },
        ])).toBe('https://github.com/octo/demo\tx-access-token\tp1\nhttps://github.com/\tu\tp2\n');
    });
});
