/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { IEngine } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { createShutdown } from '@chamvi/http';
import type { ShutdownOptions } from '@chamvi/http';
import { createTestApp } from '../../utils/app.ts';

const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

function setup(overrides: Partial<ShutdownOptions> = {}) {
    const order: string[] = [];
    const clock = new ControllableClock(new Date(0));
    const drain = vi.fn<(opts?: { timeoutMs?: number }) => Promise<void>>(async () => {
        order.push('drain');
    });
    const engine = { drain, clock } as unknown as IEngine;
    const errors: unknown[] = [];
    const server = {
        close: vi.fn<(force?: boolean) => Promise<void>>(async () => {
            order.push('server');
        }),
    };
    const shutdown = createShutdown({
        engine,
        server,
        onError: (error) => {
            errors.push(error);
        },
        ...overrides,
    });

    return {
        order,
        clock,
        drain,
        server,
        shutdown,
        errors,
    };
}

describe('createShutdown', () => {
    it('fails readiness, runs callbacks in the order added, closes the server and drains', async () => {
        const ctx = setup();
        let readyFailedFirst = false;

        ctx.shutdown.onShutdown(async () => {
            readyFailedFirst = ctx.shutdown.shuttingDown;
            ctx.order.push('first');
        });
        ctx.shutdown.onShutdown(() => {
            ctx.order.push('callback');
        });
        expect(ctx.shutdown.shuttingDown).toBe(false);

        await ctx.shutdown.shutdown();

        expect(ctx.order).toEqual(['first', 'callback', 'server', 'drain']);
        expect(readyFailedFirst).toBe(true);
        expect(ctx.drain).toHaveBeenCalledWith({ timeoutMs: 30_000 });
        expect(ctx.server.close).toHaveBeenCalledTimes(1);
    });

    it('waits readinessDelayMs before stopping anything', async () => {
        const ctx = setup({ readinessDelayMs: 5_000 });
        const callback = vi.fn();

        ctx.shutdown.onShutdown(callback);

        const done = ctx.shutdown.shutdown();

        await flush();
        expect(ctx.shutdown.shuttingDown).toBe(true);
        expect(callback).not.toHaveBeenCalled();
        expect(ctx.drain).not.toHaveBeenCalled();
        ctx.clock.advance(5_000);
        await done;
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('is idempotent', async () => {
        const ctx = setup();
        const first = ctx.shutdown.shutdown();
        const second = ctx.shutdown.shutdown();

        expect(second).toBe(first);
        await first;
        expect(ctx.drain).toHaveBeenCalledTimes(1);
    });

    it('reports a throwing callback and still drains', async () => {
        const ctx = setup();
        const error = new Error('callback failed');

        ctx.shutdown.onShutdown(() => {
            throw error;
        });
        await ctx.shutdown.shutdown();
        expect(ctx.errors).toEqual([error]);
        expect(ctx.drain).toHaveBeenCalledTimes(1);
    });

    it('removes a callback through the returned function', async () => {
        const ctx = setup();
        const callback = vi.fn();
        const off = ctx.shutdown.onShutdown(callback);

        off();
        await ctx.shutdown.shutdown();
        expect(callback).not.toHaveBeenCalled();
    });

    it('forces the server closed after closeTimeoutMs', async () => {
        const ctx = setup();

        ctx.server.close.mockImplementation((force?: boolean) => (force ? Promise.resolve() : new Promise(() => {})));

        let settled = false;
        const done = ctx.shutdown.shutdown().then(() => {
            settled = true;
        });

        await vi.waitFor(() => expect(ctx.drain).toHaveBeenCalled());
        await flush();
        expect(settled).toBe(false);
        ctx.clock.advance(5_000);
        await done;
        expect(ctx.server.close).toHaveBeenCalledTimes(2);
        expect(ctx.server.close).toHaveBeenLastCalledWith(true);
        expect(ctx.errors).toEqual([]);
    });

    it('does not force a server that closed in time', async () => {
        const ctx = setup();

        await ctx.shutdown.shutdown();
        expect(ctx.server.close).not.toHaveBeenCalledWith(true);
    });

    it('reports a rejecting close', async () => {
        const ctx = setup();
        const error = new Error('close failed');

        ctx.server.close.mockImplementation(async () => {
            throw error;
        });
        await ctx.shutdown.shutdown();
        expect(ctx.errors).toEqual([error]);
    });
});

describe('createHttpApp with a shutdown', () => {
    it('registers one callback that runs the app closers', async () => {
        const callbacks: (() => void | Promise<void>)[] = [];

        createTestApp({
            shutdown: {
                shuttingDown: false,
                onShutdown: (fn) => {
                    callbacks.push(fn);

                    return () => {};
                },
                shutdown: async () => {},
            },
        });
        expect(callbacks).toHaveLength(1);
        await callbacks[0]?.();
    });
});
