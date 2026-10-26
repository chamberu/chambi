/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@chamvi/core';
import { assertGitRef, normalizeRepo } from '@chamvi/sandbox';

describe('normalizeRepo', () => {
    it('expands owner/name to a GitHub https URL', () => {
        expect(normalizeRepo('octo/demo')).toBe('https://github.com/octo/demo.git');
        expect(normalizeRepo('octo-org/demo.js')).toBe('https://github.com/octo-org/demo.js.git');
    });

    it('keeps an https URL', () => {
        expect(normalizeRepo('https://github.com/octo/demo.git')).toBe('https://github.com/octo/demo.git');
        expect(normalizeRepo('https://gitlab.com/a/b')).toBe('https://gitlab.com/a/b');
    });

    it.each([
        'git@github.com:o/r.git',
        'ssh://github.com/o/r',
        'http://github.com/o/r',
        'ext::sh -c id',
        'https://github.com/o/r?x=1',
        'https://github.com/o/r#main',
        'file:///tmp/r',
        '-o/r',
        '--upload-pack=x',
        '',
        'o/r\0',
        'https://',
        'not a url',
        'https://git\nhub.com/o/r',
        'https://github.com/o/r\t',
        'https://gitlab.com/o/%zz.git',
        'https://gitlab.com/o/r%',
        'https://gitlab.com/o/%E0%A4%A.git',
    ])('rejects %j', (input) => {
        expect(() => normalizeRepo(input)).toThrow(ValidationError);
    });

    it.each([
        'https://user:token@github.com/o/r',
        'https://token@github.com/o/r',
        'https://x-access-token:token@github.com/o/r?token=1',
    ])('rejects credentials in %j without echoing them', (input) => {
        let error: unknown;
        try {
            normalizeRepo(input);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).not.toContain('token');
        expect(JSON.stringify(error)).not.toContain('token');
    });

    it('accepts an absolute file URL only with allowFileRepos', () => {
        expect(normalizeRepo('file:///tmp/r', { allowFileRepos: true })).toBe('file:///tmp/r');
        expect(() => normalizeRepo('file://relative', { allowFileRepos: true })).toThrow(ValidationError);
        expect(() => normalizeRepo('file://host/tmp/r', { allowFileRepos: true })).toThrow(ValidationError);
        expect(() => normalizeRepo('file:///tmp/r?x', { allowFileRepos: true })).toThrow(ValidationError);
    });

    it('applies allowRepo to the normalized URL', () => {
        const seen: string[] = [];
        expect(() => normalizeRepo('octo/demo', {
            allowRepo: (url) => {
                seen.push(url);
                return false;
            },
        })).toThrow(/repository not allowed/);
        expect(seen).toEqual(['https://github.com/octo/demo.git']);
        expect(normalizeRepo('octo/demo', { allowRepo: () => true })).toBe('https://github.com/octo/demo.git');
    });

    it('rejects a non-string', () => {
        expect(() => normalizeRepo(1 as unknown as string)).toThrow(ValidationError);
    });
});

describe('assertGitRef', () => {
    it.each([
        'main',
        'v1.2.3',
        'refs/tags/v1',
        'feature/a-b_c+d',
        'a'.repeat(40).replace(/a/g, 'f'),
        'a'.repeat(255),
    ])('accepts %j', (ref) => {
        expect(() => assertGitRef(ref)).not.toThrow();
    });

    it.each([
        '-x',
        '--upload-pack=x',
        '--upload-pack=touch /tmp/x',
        'a..b',
        'a//b',
        'a@{1}',
        'a/',
        'a.lock',
        '',
        'a'.repeat(256),
        '.hidden',
        'a b',
        'a\0b',
        'a~1',
        'a^',
        'a:b',
    ])('rejects %j', (ref) => {
        expect(() => assertGitRef(ref)).toThrow(ValidationError);
    });

    it('rejects a non-string', () => {
        expect(() => assertGitRef(undefined as unknown as string)).toThrow(ValidationError);
    });
});
