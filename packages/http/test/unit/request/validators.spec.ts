/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { IssueCode } from '@ebec/core';
import { Container, ValidupError } from 'validup';
import { describe, expect, it } from 'vitest';
import {
    isArrayOf,
    isBase64,
    isBoolean,
    isDefined,
    isMediaType,
    isString,
} from '../../../src/request/validators.ts';
import type { ValidatorDescriptor } from 'validup';

async function run(validator: ValidatorDescriptor, input: Record<string, unknown>) {
    const container = new Container<{ k: unknown }>();

    container.mount('k', validator);

    return container.run(input);
}

async function rejects(validator: ValidatorDescriptor, input: Record<string, unknown>, code: string = IssueCode.VALUE_INVALID) {
    const error = await run(validator, input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidupError);
    expect((error as ValidupError).issues[0]).toMatchObject({ path: ['k'], code });
}

describe('validators', () => {
    it('isString checks type and length', async () => {
        const v = isString({ min: 1, max: 3 });

        expect(await run(v, { k: 'a' })).toEqual({ k: 'a' });
        expect(await run(v, { k: 'abc' })).toEqual({ k: 'abc' });
        await rejects(v, { k: '' });
        await rejects(v, { k: 'abcd' });
        await rejects(v, { k: 1 });
        await rejects(v, {});
    });

    it('isBoolean accepts booleans only', async () => {
        expect(await run(isBoolean(), { k: true })).toEqual({ k: true });
        expect(await run(isBoolean(), { k: false })).toEqual({ k: false });
        await rejects(isBoolean(), { k: 'yes' });
        await rejects(isBoolean(), { k: 0 });
    });

    it('isDefined accepts everything but undefined', async () => {
        expect(await run(isDefined(), { k: null })).toEqual({ k: null });
        expect(await run(isDefined(), { k: 0 })).toEqual({ k: 0 });
        expect(await run(isDefined(), { k: {} })).toEqual({ k: {} });
        await rejects(isDefined(), {}, IssueCode.REQUIRED);
    });

    it('isArrayOf checks type and length before any item', async () => {
        const item = new Container<{ n: string }>();

        item.mount('n', isString({ min: 1, max: 3 }));

        const v = isArrayOf(item, { max: 2 });

        expect(await run(v, { k: [] })).toEqual({ k: [] });
        expect(await run(v, { k: [{ n: 'a', x: 1 }, { n: 'b' }] })).toEqual({ k: [{ n: 'a' }, { n: 'b' }] });
        await rejects(v, { k: [{}, {}, {}] });
        await rejects(v, { k: 'ab' });
        await rejects(v, { k: { 0: 1 } });
        await rejects(v, { k: null });

        const error = await run(v, { k: [{ n: 'a' }, { n: '' }] }).catch((e: unknown) => e) as ValidupError;

        expect(error).toBeInstanceOf(ValidupError);
        expect(error.issues.map((issue) => issue.path)).toEqual([['k', 1, 'n']]);
    });

    it('isMediaType accepts type/subtype without parameters', async () => {
        for (const value of ['image/png', 'application/vnd.api+json', 'text/plain']) {
            expect(await run(isMediaType(), { k: value })).toEqual({ k: value });
        }

        for (const value of ['png', 'image/', '/png', 'text/plain; charset=utf-8', 'a/b\0', 'image/png\r\nx: y', 1, '']) {
            await rejects(isMediaType(), { k: value });
        }
    });

    it('isBase64 decodes strict base64 to a plain Uint8Array', async () => {
        const out = await run(isBase64(), { k: 'aGk=' }) as { k: Uint8Array };

        expect(out.k).toBeInstanceOf(Uint8Array);
        expect(Buffer.isBuffer(out.k)).toBe(false);
        expect([...out.k]).toEqual([104, 105]);
        expect([...(await run(isBase64(), { k: '' }) as { k: Uint8Array }).k]).toEqual([]);
        expect([...(await run(isBase64(), { k: '+/8=' }) as { k: Uint8Array }).k]).toEqual([251, 255]);
    });

    it.each([
        'aGk',
        'aGk==',
        'aG k=',
        'aGk=\n',
        '-_8=',
        'aGl=',
        '=aGk',
        'a===',
    ])('isBase64 rejects %j', async (value) => {
        await rejects(isBase64(), { k: value });
    });

    it('isBase64 rejects non-strings', async () => {
        await rejects(isBase64(), { k: 1 });
        await rejects(isBase64(), { k: null });
    });

    it.each([
        ['isString', isString({ max: 3 }), 'x'.repeat(100_000)],
        ['isString (NUL)', isString({ max: 200_000 }), `${'x'.repeat(100_000)}\0`],
        ['isMediaType', isMediaType(), 'x'.repeat(100_000)],
        ['isArrayOf', isArrayOf(new Container(), { max: 1 }), Array.from({ length: 3 }, () => 'x'.repeat(50_000))],
        ['isArrayOf (no array)', isArrayOf(new Container(), { max: 1 }), 'x'.repeat(100_000)],
    ])('%s never echoes a large received value', async (_, validator, value) => {
        const error = await run(validator, { k: value }).catch((e: unknown) => e) as ValidupError;

        expect(error).toBeInstanceOf(ValidupError);
        expect(JSON.stringify(error.issues).length).toBeLessThan(1024);
    });

    it('keeps a short received value', async () => {
        const error = await run(isMediaType(), { k: 'png' }).catch((e: unknown) => e) as ValidupError;

        expect(error.issues[0]).toMatchObject({ received: 'png' });
    });
});
