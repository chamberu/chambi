/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { Env } from '../env/index.ts';
import {
    TIMER_MAX_MS,
    envBoolean,
    envInteger,
    envOneOf,
    envString,
    envUrl,
} from '../env/index.ts';
import {
    BASE_PATH_PATTERN,
    DATABASE_URL_PROTOCOLS,
    DEFAULT_AGENTS_POLL_MS,
    DEFAULT_CLOSE_TIMEOUT_MS,
    DEFAULT_DRAIN_TIMEOUT_MS,
    DEFAULT_HOST,
    DEFAULT_MAX_CONCURRENT_RUNS,
    DEFAULT_PORT,
    DEFAULT_PURGE_INTERVAL_MS,
    DEFAULT_READINESS_DELAY_MS,
    DEV_DRAIN_TIMEOUT_MS,
    LOG_LEVELS,
    PUBLIC_URL_PROTOCOLS,
} from './constants.ts';
import { readTokens } from './helpers.ts';
import type { AppConfig, ReadConfigOptions } from './types.ts';

function readBasePath(env: Env): string {
    const value = envString(env, 'CHAMVI_BASE_PATH', { default: '' });
    if (value.length > 0 && !BASE_PATH_PATTERN.test(value)) {
        throw new InvalidAgentDefinitionError(
            'CHAMVI_BASE_PATH must be a lower-case path such as /api, without a trailing slash.',
        );
    }

    return value;
}

/**
 * The app config from env (C4). Pure: reads only the given env.
 */
export function readConfig(env: Env, options: ReadConfigOptions): AppConfig {
    const dev = options.dev ?? false;

    const publicUrl = envUrl(env, 'CHAMVI_PUBLIC_URL', { protocols: PUBLIC_URL_PROTOCOLS });
    const url = envUrl(env, 'DATABASE_URL', {
        protocols: DATABASE_URL_PROTOCOLS,
        required: options.mode === 'migrate',
    });
    const tokens = readTokens(env);
    const agentsDir = envString(env, 'CHAMVI_AGENTS_DIR');

    return {
        dev,
        logLevel: envOneOf(env, 'CHAMVI_LOG_LEVEL', LOG_LEVELS, { default: 'info' }),
        http: {
            port: envInteger(env, 'PORT', {
                default: DEFAULT_PORT,
                min: 1,
                max: 65535,
            }),
            host: envString(env, 'HOST', { default: DEFAULT_HOST }),
            basePath: readBasePath(env),
            ...(typeof publicUrl === 'string' ? { publicUrl } : {}),
            readinessDelayMs: envInteger(env, 'CHAMVI_READINESS_DELAY_MS', { default: DEFAULT_READINESS_DELAY_MS, max: TIMER_MAX_MS }),
            drainTimeoutMs: envInteger(env, 'CHAMVI_DRAIN_TIMEOUT_MS', { default: dev ? DEV_DRAIN_TIMEOUT_MS : DEFAULT_DRAIN_TIMEOUT_MS, max: TIMER_MAX_MS }),
            closeTimeoutMs: envInteger(env, 'CHAMVI_CLOSE_TIMEOUT_MS', { default: DEFAULT_CLOSE_TIMEOUT_MS, max: TIMER_MAX_MS }),
        },
        store: {
            ...(typeof url === 'string' ? { url } : {}),
            migrate: envBoolean(env, 'CHAMVI_MIGRATE', { default: true }),
            purgeIntervalMs: envInteger(env, 'CHAMVI_PURGE_INTERVAL_MS', { default: DEFAULT_PURGE_INTERVAL_MS, max: TIMER_MAX_MS }),
        },
        engine: {
            concurrencyMaxRuns: envInteger(env, 'CHAMVI_MAX_CONCURRENT_RUNS', {
                default: DEFAULT_MAX_CONCURRENT_RUNS,
                min: 1,
            }),
        },
        scheduler: { enabled: envBoolean(env, 'CHAMVI_SCHEDULER', { default: true }) },
        agents: {
            ...(typeof agentsDir === 'string' ? { dir: agentsDir } : {}),
            pollMs: envInteger(env, 'CHAMVI_AGENTS_POLL_MS', {
                default: DEFAULT_AGENTS_POLL_MS,
                min: 1,
                max: TIMER_MAX_MS,
            }),
        },
        ...(typeof tokens !== 'undefined' ? { tokens } : {}),
    };
}
