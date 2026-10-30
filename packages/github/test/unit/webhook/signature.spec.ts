/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { verifySignature } from '../../../src/webhook/helpers.ts';
import { createGithubFixture, sign } from '../../utils/app.ts';

const encode = (text: string) => new TextEncoder().encode(text);

describe('verifySignature', () => {
    const body = encode('{"zen":"Keep it logically awesome."}');

    it('accepts the right sha256 signature', () => {
        expect(verifySignature(['s3cret'], body, sign(body, 's3cret'))).toBe(true);
    });

    it('refuses a missing, sha1, wrong, short or upper-case-prefixed signature', () => {
        const right = sign(body, 's3cret');

        expect(verifySignature(['s3cret'], body, null)).toBe(false);
        expect(verifySignature(['s3cret'], body, `sha1=${right.slice(7)}`)).toBe(false);
        expect(verifySignature(['s3cret'], body, sign(body, 'other'))).toBe(false);
        expect(verifySignature(['s3cret'], body, right.slice(0, -2))).toBe(false);
        expect(verifySignature(['s3cret'], body, `SHA256=${right.slice(7)}`)).toBe(false);
        expect(verifySignature(['s3cret'], body, 'sha256=zz')).toBe(false);
    });

    it('accepts a signature under any configured secret', () => {
        expect(verifySignature(['old', 'new'], body, sign(body, 'new'))).toBe(true);
    });

    it('verifies the exact bytes, escapes and non-ASCII alike', () => {
        const escaped = encode('{"title":"caf\\u00e9",  "n":1}');
        const raw = encode('{"title":"café","n" : 1}\n');

        expect(verifySignature(['s3cret'], escaped, sign(escaped, 's3cret'))).toBe(true);
        expect(verifySignature(['s3cret'], raw, sign(raw, 's3cret'))).toBe(true);

        // re-serialized JSON is a different byte string
        const reserialized = encode(JSON.stringify(JSON.parse('{"title":"caf\\u00e9",  "n":1}')));

        expect(verifySignature(['s3cret'], reserialized, sign(escaped, 's3cret'))).toBe(false);
    });

    it('is reachable on the app under its webhook secrets', () => {
        const { gh } = createGithubFixture({ webhookSecret: ['old', 'new'] });

        expect(gh.verifySignature(body, sign(body, 'old'))).toBe(true);
        expect(gh.verifySignature(body, sign(body, 'nope'))).toBe(false);
    });
});
