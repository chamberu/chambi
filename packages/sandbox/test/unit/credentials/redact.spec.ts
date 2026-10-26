/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import { REDACTED, REDACT_GRACE_MS } from '@chamvi/sandbox';
import { createRedactor } from '../../../src/credentials/helpers.ts';
import { ControllableClock } from '../../utils/clock.ts';

describe('createRedactor', () => {
    it('forgets a secret REDACT_GRACE_MS after it expired', () => {
        const T = 1_000_000;
        const clock = new ControllableClock(new Date(T));
        const redactor = createRedactor({ clock });
        redactor.add('ghs_expiring_token', new Date(T + 1000));
        clock.advance(1000 + REDACT_GRACE_MS - 1);
        expect(redactor.redact('ghs_expiring_token')).toBe(REDACTED);
        expect(new TextDecoder().decode(redactor.redactBytes(new TextEncoder().encode('ghs_expiring_token')))).toBe(REDACTED);
        clock.advance(1);
        expect(redactor.redact('ghs_expiring_token')).toBe('ghs_expiring_token');
        expect(new TextDecoder().decode(redactor.redactBytes(new TextEncoder().encode('ghs_expiring_token')))).toBe('ghs_expiring_token');
    });

    it('keeps a secret without expiry', () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const redactor = createRedactor({ clock });
        redactor.add('ghs_static_token');
        clock.advance(100 * REDACT_GRACE_MS);
        expect(redactor.redact('ghs_static_token')).toBe(REDACTED);
    });

    it('keeps the later expiry of a secret added twice, and none wins', () => {
        const T = 1_000_000;
        const clock = new ControllableClock(new Date(T));
        const redactor = createRedactor({ clock });
        redactor.add('ghs_twice_token', new Date(T + 1000));
        redactor.add('ghs_twice_token', new Date(T + 5000));
        clock.advance(1000 + REDACT_GRACE_MS);
        expect(redactor.redact('ghs_twice_token')).toBe(REDACTED);
        redactor.add('ghs_twice_token');
        redactor.add('ghs_twice_token', new Date(T + 6000));
        clock.advance(10 * REDACT_GRACE_MS);
        expect(redactor.redact('ghs_twice_token')).toBe(REDACTED);
    });

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
