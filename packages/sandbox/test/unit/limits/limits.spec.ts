/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    DEFAULT_LIMITS,
    assertSandboxEnv,
    parseCpu,
    parseMemory,
    resolveLimits,
} from '@chamvi/sandbox';
import type { SandboxLimits } from '@chamvi/sandbox';

describe('parseCpu', () => {
    it.each([
        ['500m', 0.5],
        ['2', 2],
        ['1', 1],
        ['1.5', 1.5],
        ['250m', 0.25],
    ])('parses %j as %d cores', (input, expected) => {
        expect(parseCpu(input)).toBe(expected);
    });

    it.each(['lots', '', '-1', '1c', '1.', '.5', ' 1'])('rejects %j', (input) => {
        expect(() => parseCpu(input)).toThrow(InvalidAgentDefinitionError);
    });
});

describe('parseMemory', () => {
    it.each([
        ['2Gi', 2_147_483_648],
        ['512M', 512_000_000],
        ['1024', 1024],
        ['512Mi', 536_870_912],
        ['1Ki', 1024],
        ['1K', 1000],
        ['1Ti', 1024 ** 4],
        ['1T', 1000 ** 4],
        ['1.5Gi', 1.5 * 1024 ** 3],
    ])('parses %j as %d bytes', (input, expected) => {
        expect(parseMemory(input)).toBe(expected);
    });

    it.each(['-1Gi', 'lots', '', '1GB', '1gi', '1 Gi'])('rejects %j', (input) => {
        expect(() => parseMemory(input)).toThrow(InvalidAgentDefinitionError);
    });
});

describe('resolveLimits', () => {
    it('returns the defaults without layers', () => {
        expect(resolveLimits()).toEqual(DEFAULT_LIMITS);
    });

    it('lets later layers win and keeps the rest', () => {
        expect(resolveLimits(DEFAULT_LIMITS, { memory: '1Gi' })).toEqual({
            ...DEFAULT_LIMITS,
            memory: '1Gi',
        });
        expect(resolveLimits({ cpu: '2' }, undefined, { cpu: '500m', pids: 64 })).toEqual({
            ...DEFAULT_LIMITS,
            cpu: '500m',
            pids: 64,
        });
    });

    it('ignores undefined values in a layer', () => {
        expect(resolveLimits({ cpu: '2' }, { cpu: undefined })).toEqual({ ...DEFAULT_LIMITS, cpu: '2' });
    });

    it('returns a fresh object', () => {
        const limits = resolveLimits();
        expect(limits).not.toBe(DEFAULT_LIMITS);
        expect(Object.isFrozen(limits)).toBe(false);
    });

    it.each<SandboxLimits>([
        { cpu: 'lots' },
        { cpu: '0' },
        { cpu: '0m' },
        { memory: '-1Gi' },
        { memory: '0' },
        { storage: '0' },
        { pids: 0 },
        { pids: 1.5 },
        { pids: NaN },
        { maxLifetimeMs: 999 },
        { maxLifetimeMs: 1500.5 },
        { maxLifetimeMs: Infinity },
        { cpu: 1 as unknown as string },
        { pids: '4' as unknown as number },
    ])('rejects %j', (layer) => {
        expect(() => resolveLimits(DEFAULT_LIMITS, layer)).toThrow(InvalidAgentDefinitionError);
    });

    it.each([1_000, 86_400_000, 2_592_000_000])('accepts maxLifetimeMs %d', (maxLifetimeMs) => {
        expect(resolveLimits({ maxLifetimeMs }).maxLifetimeMs).toBe(maxLifetimeMs);
    });

    it('rejects the former timeoutMs, naming maxLifetimeMs', () => {
        // a config object spread in skips the excess-property check
        const layer = { timeoutMs: 1_800_000 } as unknown as SandboxLimits;
        expect(() => resolveLimits(layer)).toThrow(InvalidAgentDefinitionError);
        expect(() => resolveLimits(layer)).toThrow(/limits\.timeoutMs .*limits\.maxLifetimeMs/);
        expect(() => resolveLimits({ timeoutMs: undefined } as unknown as SandboxLimits)).not.toThrow();
    });

    it('rejects a layer that is no object', () => {
        expect(() => resolveLimits('x' as unknown as SandboxLimits)).toThrow(InvalidAgentDefinitionError);
    });
});

describe('assertSandboxEnv', () => {
    it('accepts undefined and valid entries', () => {
        expect(() => assertSandboxEnv(undefined)).not.toThrow();
        expect(() => assertSandboxEnv({ NODE_ENV: 'test', _A1: '' })).not.toThrow();
    });

    it.each<Record<string, string>>([
        { 'A-B': 'x' },
        { A: 'x\0' },
        { '1A': 'x' },
        { '': 'x' },
        { A: 1 as unknown as string },
    ])('rejects %j', (env) => {
        expect(() => assertSandboxEnv(env)).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects an env that is no object', () => {
        expect(() => assertSandboxEnv([] as unknown as Record<string, string>)).toThrow(InvalidAgentDefinitionError);
    });
});
