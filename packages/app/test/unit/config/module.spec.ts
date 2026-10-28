/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { describe, expect, it } from 'vitest';
import { TIMER_MAX_MS, readConfig } from '@chamvi/app';


function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a throw');
}

function start(env: Record<string, string | undefined>) {
    return readConfig({ ...env }, { mode: 'start' });
}

describe('readConfig', () => {
    it('defaults', () => {
        expect(readConfig({}, { mode: 'start' })).toEqual({
            dev: false,
            logLevel: 'info',
            http: {
                port: 3000,
                host: '0.0.0.0',
                basePath: '',
                readinessDelayMs: 0,
                drainTimeoutMs: 30_000,
                closeTimeoutMs: 5_000,
            },
            store: {
                migrate: true,
                purgeIntervalMs: 3_600_000,
            },
            engine: { concurrencyMaxRuns: 4 },
            scheduler: { enabled: true },
            agents: { pollMs: 5_000 },
        });
    });

    it('reads every variable', () => {
        const config = readConfig({
            PORT: '8080',
            HOST: '127.0.0.1',
            CHAMVI_BASE_PATH: '/api',
            CHAMVI_PUBLIC_URL: 'https://a.example/',
            CHAMVI_LOG_LEVEL: 'debug',
            DATABASE_URL: 'postgres://u:p@db:5432/chamvi',
            CHAMVI_MIGRATE: 'false',
            CHAMVI_PURGE_INTERVAL_MS: '60000',
            CHAMVI_MAX_CONCURRENT_RUNS: '8',
            CHAMVI_SCHEDULER: '0',
            CHAMVI_READINESS_DELAY_MS: '1000',
            CHAMVI_DRAIN_TIMEOUT_MS: '20000',
            CHAMVI_CLOSE_TIMEOUT_MS: '2000',
            CHAMVI_AGENTS_DIR: './agents',
            CHAMVI_AGENTS_POLL_MS: '2000',
        }, { mode: 'start' });

        expect(config).toEqual({
            dev: false,
            logLevel: 'debug',
            http: {
                port: 8080,
                host: '127.0.0.1',
                basePath: '/api',
                publicUrl: 'https://a.example',
                readinessDelayMs: 1000,
                drainTimeoutMs: 20_000,
                closeTimeoutMs: 2000,
            },
            store: {
                url: 'postgres://u:p@db:5432/chamvi',
                migrate: false,
                purgeIntervalMs: 60_000,
            },
            engine: { concurrencyMaxRuns: 8 },
            scheduler: { enabled: false },
            agents: { dir: './agents', pollMs: 2000 },
        });
    });

    it('dev drain default is 5000, an explicit CHAMVI_DRAIN_TIMEOUT_MS wins', () => {
        expect(readConfig({}, { mode: 'start', dev: true }).http.drainTimeoutMs).toBe(5000);
        expect(readConfig({ CHAMVI_DRAIN_TIMEOUT_MS: '7000' }, { mode: 'start', dev: true }).http.drainTimeoutMs)
            .toBe(7000);
    });

    it('PORT 0 and 65536 throw', () => {
        expect(() => start({ PORT: '0' })).toThrow(InvalidAgentDefinitionError);
        expect(() => start({ PORT: '65536' })).toThrow(InvalidAgentDefinitionError);
        expect(start({ PORT: '65535' }).http.port).toBe(65535);
    });

    it('CHAMVI_MAX_CONCURRENT_RUNS 0 throws', () => {
        expect(() => start({ CHAMVI_MAX_CONCURRENT_RUNS: '0' })).toThrow(/CHAMVI_MAX_CONCURRENT_RUNS/);
    });

    it.each([
        'CHAMVI_READINESS_DELAY_MS',
        'CHAMVI_DRAIN_TIMEOUT_MS',
        'CHAMVI_CLOSE_TIMEOUT_MS',
        'CHAMVI_PURGE_INTERVAL_MS',
    ])('%s above the timer limit throws (Node would fire it after 1 ms)', (name) => {
        expect(() => start({ [name]: String(TIMER_MAX_MS + 1) })).toThrow(`${name} must be at most ${TIMER_MAX_MS}.`);
        expect(() => start({ [name]: String(TIMER_MAX_MS) })).not.toThrow();
    });

    it('CHAMVI_AGENTS_DIR empty is unset', () => {
        expect(start({ CHAMVI_AGENTS_DIR: '' }).agents).toEqual({ pollMs: 5_000 });
    });

    it('CHAMVI_AGENTS_POLL_MS must be 1 to the timer limit', () => {
        expect(() => start({ CHAMVI_AGENTS_POLL_MS: '0' })).toThrow('CHAMVI_AGENTS_POLL_MS must be at least 1.');
        expect(() => start({ CHAMVI_AGENTS_POLL_MS: String(TIMER_MAX_MS + 1) }))
            .toThrow(`CHAMVI_AGENTS_POLL_MS must be at most ${TIMER_MAX_MS}.`);
        expect(start({ CHAMVI_AGENTS_POLL_MS: '1' }).agents.pollMs).toBe(1);
        expect(start({ CHAMVI_AGENTS_POLL_MS: String(TIMER_MAX_MS) }).agents.pollMs).toBe(TIMER_MAX_MS);
    });

    it('CHAMVI_PURGE_INTERVAL_MS 0 disables', () => {
        expect(start({ CHAMVI_PURGE_INTERVAL_MS: '0' }).store.purgeIntervalMs).toBe(0);
    });

    it('CHAMVI_BASE_PATH accepts /api, rejects api, /api/, /API', () => {
        expect(start({ CHAMVI_BASE_PATH: '/api' }).http.basePath).toBe('/api');
        expect(start({ CHAMVI_BASE_PATH: '/api/v1' }).http.basePath).toBe('/api/v1');

        for (const value of ['api', '/api/', '/API', '/', '//api']) {
            const error = errorOf(() => start({ CHAMVI_BASE_PATH: value }));

            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(error.message).toContain('CHAMVI_BASE_PATH');
        }
    });

    it('CHAMVI_LOG_LEVEL accepts the four levels and rejects verbose listing them', () => {
        for (const level of ['error', 'warn', 'info', 'debug']) {
            expect(start({ CHAMVI_LOG_LEVEL: level }).logLevel).toBe(level);
        }

        expect(() => start({ CHAMVI_LOG_LEVEL: 'verbose' }))
            .toThrow('CHAMVI_LOG_LEVEL must be one of error, warn, info, debug.');
    });

    it('CHAMVI_PUBLIC_URL must be absolute http(s)', () => {
        expect(() => start({ CHAMVI_PUBLIC_URL: 'a.example' })).toThrow(/CHAMVI_PUBLIC_URL/);
        expect(() => start({ CHAMVI_PUBLIC_URL: 'ftp://a.example' })).toThrow(/CHAMVI_PUBLIC_URL/);
        expect(start({ CHAMVI_PUBLIC_URL: 'http://a.example/x/' }).http.publicUrl).toBe('http://a.example/x');
    });

    it('migrate mode requires DATABASE_URL', () => {
        const error = errorOf(() => readConfig({}, { mode: 'migrate' }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('DATABASE_URL');
    });

    it('DATABASE_URL must be postgres:// or postgresql://', () => {
        expect(start({ DATABASE_URL: 'postgres://db/chamvi' }).store.url).toBe('postgres://db/chamvi');
        expect(start({ DATABASE_URL: 'postgresql://db/chamvi' }).store.url).toBe('postgresql://db/chamvi');
        expect(() => start({ DATABASE_URL: 'mysql://u:hunter2@db/chamvi' })).toThrow(/DATABASE_URL/);
        expect(errorOf(() => start({ DATABASE_URL: 'mysql://u:hunter2@db/chamvi' })).message).not.toContain('hunter2');
    });

    describe('CHAMVI_TOKENS', () => {
        const valid = {
            value: 'a'.repeat(16),
            id: 'ops',
            permissions: ['*'],
        };

        it('parses a valid JSON array', () => {
            const config = start({
                CHAMVI_TOKENS: JSON.stringify([valid, {
                    value: 'b'.repeat(20),
                    id: 'ci',
                    permissions: [],
                    extra: 1,
                }]),
            });

            expect(config.tokens).toEqual([
                valid,
                {
                    value: 'b'.repeat(20),
                    id: 'ci',
                    permissions: [],
                },
            ]);
        });

        it.each([
            ['a non-array', { a: 1 }],
            ['an empty array', []],
            ['a non-object item', [valid, 'x']],
            ['a short value', [valid, {
                value: 'short',
                id: 'x',
                permissions: [],
            }]],
            ['a duplicate value', [valid, { ...valid, id: 'other' }]],
            ['an empty id', [{ ...valid, id: '' }]],
            ['a missing id', [{ value: valid.value, permissions: [] }]],
            ['non-string permissions', [{ ...valid, permissions: [1] }]],
            ['missing permissions', [{ value: valid.value, id: 'x' }]],
        ])('rejects %s', (_, value) => {
            const error = errorOf(() => start({ CHAMVI_TOKENS: JSON.stringify(value) }));

            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(error.message).toContain('CHAMVI_TOKENS');
        });

        it('rejects malformed JSON', () => {
            expect(() => start({ CHAMVI_TOKENS: '[{' })).toThrow('CHAMVI_TOKENS must be valid JSON.');
        });

        it('CHAMVI_TOKENS error names no token', () => {
            const secret = 'sekr3t-tok';
            const short = errorOf(() => start({
                CHAMVI_TOKENS: JSON.stringify([valid, {
                    value: secret,
                    id: 'x',
                    permissions: [],
                }]),
            }));

            expect(short.message).toBe('CHAMVI_TOKENS[1].value must be at least 16 characters.');

            const duplicate = errorOf(() => start({ CHAMVI_TOKENS: JSON.stringify([valid, { ...valid, id: 'y' }]) }));

            expect(duplicate.message).toBe('CHAMVI_TOKENS[1].value is given more than once.');
            expect(duplicate.message).not.toContain(valid.value);
        });
    });
});
