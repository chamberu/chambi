/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IEngine } from '@chamvi/core';

export interface IShutdown {
    /** True from the first `shutdown()` call on; `/readyz` then fails. */
    readonly shuttingDown: boolean;
    /**
     * Runs `fn` during the shutdown, in the order added, after readiness
     * failed and before the server closes; returns an unsubscribe.
     */
    onShutdown(fn: () => void | Promise<void>): () => void;
    /** Idempotent: every call returns the same promise. */
    shutdown(): Promise<void>;
}

export type ShutdownOptions = {
    /** Drained on shutdown; its `clock` times the delays. */
    engine: IEngine;
    /** srvx `Server` (pass `gracefulShutdown: false` to `serve`). */
    server?: { close(closeActiveConnections?: boolean): Promise<void> };
    /** Time for load balancers to see the failing readiness. Default 0. */
    readinessDelayMs?: number;
    /** Default 30 s. */
    drainTimeoutMs?: number;
    /** Wait for open connections after the drain, then close them. Default 5 s. */
    closeTimeoutMs?: number;
    /** Default `console.error`. */
    onError?: (error: unknown) => void;
};
