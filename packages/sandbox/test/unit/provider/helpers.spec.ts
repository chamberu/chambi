/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, SandboxError, ValidationError } from '@chamvi/core';
import {
    abortedCreate,
    assertClockOption,
    assertCreateInput,
    assertImageOption,
    assertTmpSizeOption,
    buildWorkspaceInfo,
    collectionError,
    isExpiredAt,
} from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';

describe('assertCreateInput', () => {
    it('refuses a missing or empty runId', () => {
        expect(() => assertCreateInput({ runId: '' })).toThrow(ValidationError);
        expect(() => assertCreateInput(undefined as never)).toThrow('runId must be a non-empty string.');
    });

    it('checks the image only when asked', () => {
        expect(() => assertCreateInput({ runId: 'r', image: '' })).not.toThrow();
        expect(() => assertCreateInput({ runId: 'r', image: '' }, { image: true })).toThrow('image must be a non-empty string.');
        expect(() => assertCreateInput({ runId: 'r', image: 'a\0b' }, { image: true })).toThrow(ValidationError);
        expect(() => assertCreateInput({ runId: 'r', image: 'node:24' }, { image: true })).not.toThrow();
    });

    it('checks the env', () => {
        expect(() => assertCreateInput({ runId: 'r', env: { 'BAD-KEY': 'x' } })).toThrow(InvalidAgentDefinitionError);
    });
});

describe('abortedCreate', () => {
    it('is a SandboxError with the cause when given', () => {
        const cause = new Error('dropped');
        expect(abortedCreate()).toBeInstanceOf(SandboxError);
        expect(abortedCreate().message).toBe('workspace creation aborted');
        expect(abortedCreate().cause).toBeUndefined();
        expect(abortedCreate(cause).cause).toBe(cause);
    });
});

describe('option checks', () => {
    it('assertImageOption takes undefined or a non-empty string without NUL', () => {
        expect(() => assertImageOption(undefined)).not.toThrow();
        expect(() => assertImageOption('node:24')).not.toThrow();
        expect(() => assertImageOption('')).toThrow(InvalidAgentDefinitionError);
        expect(() => assertImageOption(42)).toThrow('image must be a non-empty string.');
    });

    it('assertClockOption takes undefined or an IClock', () => {
        expect(() => assertClockOption(undefined)).not.toThrow();
        expect(() => assertClockOption(new ControllableClock())).not.toThrow();
        expect(() => assertClockOption({ now: () => new Date() })).toThrow('clock must be an IClock.');
    });
});

describe('buildWorkspaceInfo', () => {
    it('expires maxLifetimeMs after createdAt and names the repo and ref when given', () => {
        const createdAt = new Date(1_000);
        expect(buildWorkspaceInfo({ runId: 'r' }, 'local', createdAt, 5_000)).toEqual({
            runId: 'r',
            provider: 'local',
            createdAt,
            expiresAt: new Date(6_000),
        });
        const info = buildWorkspaceInfo({
            runId: 'r', 
            repo: 'https://example.com/a/b.git', 
            ref: 'main', 
        }, 'k8s', createdAt, 5_000);
        expect(info.repo).toBe('https://example.com/a/b.git');
        expect(info.ref).toBe('main');
    });
});

describe('isExpiredAt', () => {
    it('is true for an expiry at or before now', () => {
        expect(isExpiredAt('100', 100)).toBe(true);
        expect(isExpiredAt('99', 100)).toBe(true);
        expect(isExpiredAt('101', 100)).toBe(false);
    });

    it('is false for a missing or unreadable value', () => {
        expect(isExpiredAt(undefined, 100)).toBe(false);
        expect(isExpiredAt('', 100)).toBe(false);
        expect(isExpiredAt('soon', 100)).toBe(false);
    });
});

describe('collectionError', () => {
    it('names the count and the first failure and carries every failure', () => {
        const failures = [new Error('first'), 'second'];
        const error = collectionError(2, failures);
        expect(error).toBeInstanceOf(SandboxError);
        expect(error.message).toBe('garbage collection removed 2 workspaces, 2 failed (first: first)');
        expect(error.cause).toBeInstanceOf(AggregateError);
        expect((error.cause as AggregateError).errors).toEqual(failures);
    });
});

describe('assertTmpSizeOption', () => {
    it('takes undefined or a positive memory quantity', () => {
        expect(() => assertTmpSizeOption(undefined)).not.toThrow();
        expect(() => assertTmpSizeOption('256Mi')).not.toThrow();
        expect(() => assertTmpSizeOption('2G')).not.toThrow();
    });

    it.each(['', 'big', '0', '-1Gi', 512])('refuses %j', (value) => {
        expect(() => assertTmpSizeOption(value)).toThrow(InvalidAgentDefinitionError);
        expect(() => assertTmpSizeOption(value)).toThrow(/^tmpSize must be a positive memory quantity like "1Gi"/);
    });
});
