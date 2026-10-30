/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@chamvi/app';
import type { LogLevel } from '@chamvi/app';

function capture(level?: LogLevel) {
    const lines: string[] = [];
    const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
    const logger = createLogger({
        level,
        clock,
        write: (line) => {
            lines.push(line);
        },
    });

    return {
        logger,
        entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
        lines,
    };
}

describe('createLogger', () => {
    it('writes one JSON line per entry with its fields', () => {
        const {
            logger,
            lines,
            entries,
        } = capture();

        logger.info('started', { port: 3000 });

        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain('\n');
        expect(entries()[0]).toEqual({
            level: 'info',
            time: '2026-10-21T00:00:00.000Z',
            msg: 'started',
            port: 3000,
        });
    });

    it('filters below level', () => {
        const info = capture('info');

        info.logger.debug('d');
        info.logger.info('i');
        info.logger.warn('w');
        info.logger.error('e');
        expect(info.entries().map((entry) => entry.level)).toEqual(['info', 'warn', 'error']);

        const error = capture('error');

        error.logger.warn('w');
        error.logger.error('e');
        expect(error.entries().map((entry) => entry.level)).toEqual(['error']);

        const debug = capture('debug');

        debug.logger.debug('d');
        expect(debug.entries()).toHaveLength(1);
    });

    it('defaults to info', () => {
        const { logger, entries } = capture();

        logger.debug('d');

        expect(entries()).toHaveLength(0);
    });

    it('serializes an error with its code', () => {
        const { logger, entries } = capture();

        logger.error('failed', new ChamviError({ code: 'x', message: 'm' }), { run: 'r1' });

        const [entry] = entries();

        expect(Object.keys(entry!)).toEqual(['level', 'time', 'msg', 'run', 'error']);
        expect(entry).toMatchObject({
            level: 'error',
            msg: 'failed',
            run: 'r1',
        });
        expect(entry!.error).toMatchObject({
            name: 'ChamviError',
            code: 'x',
            message: 'm',
        });
        expect(typeof (entry!.error as Record<string, unknown>).stack).toBe('string');
    });

    it('never expands cause or issues', () => {
        const { logger, entries } = capture();
        const error = new ChamviError({
            code: 'x',
            message: 'm',
            cause: new Error('sekr3t'),
        });

        logger.error('failed', error);

        expect(Object.keys(entries()[0]!.error as object).sort()).toEqual(['code', 'message', 'name', 'stack']);
        expect(JSON.stringify(entries()[0])).not.toContain('sekr3t');
    });

    it('uses the clock', () => {
        const { logger, entries } = capture();

        logger.warn('w');

        expect(entries()[0]!.time).toBe('2026-10-21T00:00:00.000Z');
    });

    it('a non-Error value becomes its string', () => {
        const { logger, entries } = capture();

        logger.error('failed', 'boom');
        logger.error('failed', 42);

        expect(entries().map((entry) => entry.error)).toEqual([{ message: 'boom' }, { message: '42' }]);
    });

    it('a field never overrides level, time or msg', () => {
        const { logger, entries } = capture();

        logger.info('real', {
            level: 'error',
            msg: 'fake',
            time: 'never',
        });

        expect(entries()[0]).toMatchObject({
            level: 'info',
            msg: 'real',
            time: '2026-10-21T00:00:00.000Z',
        });
    });

    it('write throwing never throws', () => {
        const logger = createLogger({
            write: () => {
                throw new Error('closed');
            },
        });

        expect(() => logger.error('e', new Error('x'))).not.toThrow();
        expect(() => logger.info('i')).not.toThrow();
    });

    it('an unserializable field never throws', () => {
        const { logger, entries } = capture();
        const circular: Record<string, unknown> = {};

        circular.self = circular;

        expect(() => logger.info('circular', { circular, big: 1n })).not.toThrow();
        expect(entries()[0]).toMatchObject({ level: 'info', msg: 'circular' });
    });
});
