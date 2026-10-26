/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@chamvi/core';
import {
    CACHE_DIR,
    CACHE_ENV,
    ROOT_CAPABILITIES,
    assertImage,
    cacheEnv,
    isRootUser,
} from '@chamvi/sandbox';
import { CACHE_FOLDERS } from '../../../src/image/constants.ts';

describe('assertImage', () => {
    it.each([
        'ghcr.io/chamvi/sandbox-dev:trixie',
        'node:24',
        'python',
        `python@sha256:${'a'.repeat(64)}`,
        'localhost:5000/team/tool:1.0_rc-2',
    ])('accepts %s', (image) => {
        expect(assertImage(image)).toBe(image);
    });

    it.each([
        ['an empty string', ''],
        ['whitespace', 'node 24'],
        ['a newline', 'node\n'],
        ['a NUL', 'node\0'],
        ['an option', '-v'],
        ['too many characters', `a${'b'.repeat(255)}`],
        ['a number', 24],
        ['undefined', undefined],
    ])('refuses %s', (_name, image) => {
        expect(() => assertImage(image)).toThrow(ValidationError);
    });

    it('never echoes the refused value', () => {
        expect(() => assertImage('secret token')).toThrow(expect.objectContaining({ message: expect.not.stringContaining('secret') as unknown as string }));
    });
});

describe('cache env', () => {
    it('points every package cache into /cache', () => {
        expect(CACHE_DIR).toBe('/cache');
        expect(CACHE_ENV).toEqual({
            XDG_CACHE_HOME: '/cache/xdg',
            npm_config_cache: '/cache/npm',
            PIP_CACHE_DIR: '/cache/pip',
            GOMODCACHE: '/cache/go/mod',
            GOCACHE: '/cache/go/build',
            COMPOSER_CACHE_DIR: '/cache/composer',
        });
        expect(Object.isFrozen(CACHE_ENV)).toBe(true);
    });

    it('keeps no toolchain home in the cache', () => {
        expect(Object.keys(CACHE_FOLDERS)).not.toContain('MISE_DATA_DIR');
    });

    it('never shares a home that holds credentials or installed programs (CARGO_HOME)', () => {
        expect(Object.keys(CACHE_ENV)).not.toContain('CARGO_HOME');
        expect(Object.keys(cacheEnv('/srv/ws/.cache'))).not.toContain('CARGO_HOME');
    });

    it('builds the same variables under another directory', () => {
        expect(cacheEnv('/srv/ws/.cache')).toEqual({
            XDG_CACHE_HOME: '/srv/ws/.cache/xdg',
            npm_config_cache: '/srv/ws/.cache/npm',
            PIP_CACHE_DIR: '/srv/ws/.cache/pip',
            GOMODCACHE: '/srv/ws/.cache/go/mod',
            GOCACHE: '/srv/ws/.cache/go/build',
            COMPOSER_CACHE_DIR: '/srv/ws/.cache/composer',
        });
    });
});

describe('root capabilities', () => {
    it('adds back only what package managers need', () => {
        expect(ROOT_CAPABILITIES).toEqual(['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'SETUID', 'SETGID', 'KILL']);
        expect(Object.isFrozen(ROOT_CAPABILITIES)).toBe(true);
    });

    it.each([0, '0', '0:0', '0:1000', 'root', 'root:root'])('reads %j as root', (user) => {
        expect(isRootUser(user)).toBe(true);
    });

    it.each([1000, '1000', '1000:1000', 'node', 'node:0'])('reads %j as no root', (user) => {
        expect(isRootUser(user)).toBe(false);
    });
});
