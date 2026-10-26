/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import { REDACTED } from '@chamvi/sandbox';
import { createRedactor } from '../../../src/credentials/helpers.ts';

describe('createRedactor', () => {
    it('replaces every issued secret in text', () => {
        const redactor = createRedactor();
        redactor.add('ghs_secret1');
        redactor.add('glpat-two');
        expect(redactor.redact('a ghs_secret1 b ghs_secret1 glpat-two')).toBe(`a ${REDACTED} b ${REDACTED} ${REDACTED}`);
        expect(redactor.redact('nothing here')).toBe('nothing here');
    });

    it('replaces the longer of two overlapping secrets whole', () => {
        const redactor = createRedactor();
        redactor.add('abcd');
        redactor.add('abcdef');
        expect(redactor.redact('xabcdefx')).toBe(`x${REDACTED}x`);
    });

    it('never treats a short value as a secret', () => {
        const redactor = createRedactor();
        redactor.add('abc');
        redactor.add('');
        expect(redactor.redact('abc')).toBe('abc');
    });

    it('replaces secrets in bytes and keeps bytes without one as they are', () => {
        const redactor = createRedactor();
        redactor.add('ghs_secret1');
        const bytes = new Uint8Array([0xFF, ...new TextEncoder().encode('xghs_secret1y'), 0x00]);
        const redacted = redactor.redactBytes(bytes);
        expect(Array.from(redacted)).toEqual([0xFF, ...new TextEncoder().encode(`x${REDACTED}y`), 0x00]);
        const clean = new Uint8Array([1, 2, 3]);
        expect(redactor.redactBytes(clean)).toBe(clean);
    });

    it('rebuilds an error whose message holds a secret as a SandboxError without its cause', () => {
        const redactor = createRedactor();
        redactor.add('ghs_secret1');
        const error = redactor.redactError(new SandboxError('bad ghs_secret1', { cause: new Error('ghs_secret1') }));
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toBe(`bad ${REDACTED}`);
        expect((error as Error).cause).toBeUndefined();
        const clean = new ValidationError('fine');
        expect(redactor.redactError(clean)).toBe(clean);
    });

    it('redacts a non-error value as text', () => {
        const redactor = createRedactor();
        redactor.add('ghs_secret1');
        expect(redactor.redactError('oops ghs_secret1')).toBeInstanceOf(SandboxError);
    });
});
