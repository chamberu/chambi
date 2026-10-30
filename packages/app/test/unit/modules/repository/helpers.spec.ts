/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { inspect } from 'node:util';
import { ChamviError } from '@chamvi/core';
import { describe, expect, it } from 'vitest';
import { createStoppedError } from '../../../../src/module/helpers.ts';
import { maskPassword } from '../../../../src/modules/repository/helpers.ts';

const URL_WITH_PASSWORD = 'postgres://u:p%40ss-w0rd@db:5432/x';

class DriverError extends Error {
    code = '28P01';
}

describe('maskPassword', () => {
    it('keeps an error that holds no password', () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:1');

        expect(maskPassword(error, URL_WITH_PASSWORD)).toBe(error);
        expect(error.message).toBe('connect ECONNREFUSED 127.0.0.1:1');
    });

    it('keeps the error for a URL without a password', () => {
        const error = new Error('postgres://u@db/x refused');

        expect(maskPassword(error, 'postgres://u@db/x')).toBe(error);
    });

    it('a password that is a substring of the stack or the message keeps the error', () => {
        const url = 'postgres://chamvi:postgres@db/chamvi';
        const error = new DriverError('relation "chamvi_checkpoints" already exists, postgres said');

        error.stack = `${error.message}\n    at PostgresQueryRunner.query (node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:1:1)`;
        expect(maskPassword(error, url)).toBe(error);
        expect(error.message).toBe('relation "chamvi_checkpoints" already exists, postgres said');
        expect(error.code).toBe('28P01');
    });

    it('leaves the app_stopped error untouched', () => {
        const error = createStoppedError();

        expect(maskPassword(error, 'postgres://u:app@db/x')).toBe(error);
        expect(error.message).toBe('The app was stopped.');
    });

    it('masks the encoded password of a URL in the message in place', () => {
        const error = new DriverError('bad url postgres://u:p%40ss-w0rd@db:5432/x');
        const masked = maskPassword(error, URL_WITH_PASSWORD);

        expect(masked).toBe(error);
        expect(error.message).toBe('bad url postgres://u:***@db:5432/x');
        expect(error.code).toBe('28P01');
        expect(inspect(error, { depth: 5 })).not.toContain('p%40ss-w0rd');
    });

    it('masks the decoded pair in the message, the stack and the cause chain', () => {
        const cause = new Error('u:p@ss-w0rd@db');
        const error = new Error('failed u:p@ss-w0rd@db', { cause });

        maskPassword(error, URL_WITH_PASSWORD);
        expect(error.message).toBe('failed u:***@db');
        expect(cause.message).toBe('u:***@db');
        expect(inspect(error, { depth: 5 })).not.toContain('p@ss-w0rd');
    });

    it('masks a field such as a driverError', () => {
        const error = Object.assign(new Error('failed'), {
            driverError: { message: `connect ${URL_WITH_PASSWORD}` },
            url: URL_WITH_PASSWORD,
        });

        expect(maskPassword(error, URL_WITH_PASSWORD)).toBe(error);
        expect(error.driverError.message).toBe('connect postgres://u:***@db:5432/x');
        expect(error.url).toBe('postgres://u:***@db:5432/x');
    });

    it('masks a ChamviError that carries the URL too', () => {
        const error = new ChamviError({ code: 'x', message: URL_WITH_PASSWORD });

        maskPassword(error, URL_WITH_PASSWORD);
        expect(error.message).toBe('postgres://u:***@db:5432/x');
    });

    it('a URL that does not parse keeps the error', () => {
        const error = new Error('x');

        expect(maskPassword(error, 'not a url')).toBe(error);
    });
});
