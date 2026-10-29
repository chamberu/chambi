/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { StaticToken } from '@chamvi/http';
import type { AppMode } from '../module/types.ts';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type AppConfig = {
    dev: boolean;
    logLevel: LogLevel;
    http: {
        port: number;
        host: string;
        basePath: string;
        publicUrl?: string;
        readinessDelayMs: number;
        drainTimeoutMs: number;
        closeTimeoutMs: number;
    };
    store: {
        /** DATABASE_URL; unset selects in-memory stores. */
        url?: string;
        migrate: boolean;
        purgeIntervalMs: number;
    };
    engine: {
        concurrencyMaxRuns: number;
    };
    scheduler: {
        enabled: boolean;
    };
    agents: {
        /** CHAMVI_AGENTS_DIR, as given (resolved against the working directory when loaded); unset means no folder. */
        dir?: string;
        /** CHAMVI_AGENTS_POLL_MS: how often the agents dir is checked for changes. */
        pollMs: number;
    };
    /** CHAMVI_TOKENS */
    tokens?: StaticToken[];
};

export type ReadConfigOptions = {
    mode: AppMode;
    dev?: boolean;
};

export type ApprovalRef = {
    runId: string;
    approvalId: string;
};
