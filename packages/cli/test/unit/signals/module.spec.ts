/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { SIGNAL_REPEAT_MS } from '../../../src/signals/constants.ts';
import { installSignalHandlers } from '../../../src/signals/module.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

type Deferred = {
    promise: Promise<void>;
    resolve(): void;
    reject(error: unknown): void
};

function deferred(): Deferred {
    return Promise.withResolvers<void>();
}

const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

describe('installSignalHandlers', () => {
    let fake: FakeProcess;
    let stop: Deferred;
    let stops: number;

    beforeEach(() => {
        fake = createFakeProcess();
        stop = deferred();
        stops = 0;
    });

    function install(forceExitMs = 90_000) {
        return installSignalHandlers({
            target: fake.signals,
            clock: fake.clock,
            forceExitMs,
            stop: () => {
                stops++;

                return stop.promise;
            },
            setExitCode: (code) => {
                fake.exitCodes.push(code);
            },
            exit: (code) => {
                fake.exits.push(code);
            },
            stderr: (text) => {
                fake.stderr.push(text);
            },
        });
    }

    it('first signal stops and sets 0', async () => {
        const handlers = install();

        expect(handlers.signalled).toBe(false);

        fake.signals.emit('SIGTERM');
        expect(handlers.signalled).toBe(true);
        expect(stops).toBe(1);
        expect(fake.stderr.join('')).toContain('received SIGTERM, stopping (again to force)');

        stop.resolve();
        await flush();
        expect(fake.exitCodes).toEqual([0]);
        expect(fake.exits).toEqual([]);
    });

    it('stop rejection sets 1', async () => {
        install();
        fake.signals.emit('SIGTERM');
        stop.reject(new Error('teardown failed'));
        await flush();
        expect(fake.exitCodes).toEqual([1]);
        expect(fake.stderr.join('')).toContain('teardown failed');
    });

    it('second signal exits 1 at once', async () => {
        install();
        fake.signals.emit('SIGTERM');
        fake.clock.advance(SIGNAL_REPEAT_MS);
        fake.signals.emit('SIGTERM');
        expect(fake.exits).toEqual([1]);
        expect(stops).toBe(1);
    });

    it('a repeat within SIGNAL_REPEAT_MS is the same signal (npm and the terminal both send one Ctrl-C)', async () => {
        install();
        fake.signals.emit('SIGINT');
        fake.signals.emit('SIGINT');
        fake.clock.advance(SIGNAL_REPEAT_MS - 1);
        fake.signals.emit('SIGINT');
        expect(fake.exits).toEqual([]);
        expect(stops).toBe(1);

        fake.clock.advance(1);
        fake.signals.emit('SIGINT');
        expect(fake.exits).toEqual([1]);
    });

    it('the force timer keeps the process alive until it fired or was cleared', () => {
        const options: unknown[] = [];
        const setTimeout = fake.clock.setTimeout.bind(fake.clock);

        fake.clock.setTimeout = (fn, ms, opts?: unknown) => {
            options.push(opts);

            return setTimeout(fn, ms);
        };
        install();
        fake.signals.emit('SIGTERM');
        expect(options).toEqual([{ keepAlive: true }]);
    });

    it('force timer exits 1 after forceExitMs', async () => {
        install();
        fake.signals.emit('SIGTERM');
        fake.clock.advance(89_999);
        expect(fake.exits).toEqual([]);
        fake.clock.advance(1);
        expect(fake.exits).toEqual([1]);
        expect(fake.stderr.join('')).toContain('forced exit');
    });

    it('the timer is cleared after a clean stop', async () => {
        install();
        fake.signals.emit('SIGTERM');
        stop.resolve();
        await flush();
        fake.clock.advance(90_000);
        expect(fake.exits).toEqual([]);
        expect(fake.exitCodes).toEqual([0]);
    });

    it('SIGINT behaves like SIGTERM', async () => {
        install(500);
        fake.signals.emit('SIGINT');
        expect(stops).toBe(1);
        expect(fake.stderr.join('')).toContain('received SIGINT, stopping (again to force)');
        fake.clock.advance(500);
        expect(fake.exits).toEqual([1]);
    });

    it('a SIGINT after a SIGTERM exits 1 at once', () => {
        install();
        fake.signals.emit('SIGTERM');
        fake.clock.advance(SIGNAL_REPEAT_MS);
        fake.signals.emit('SIGINT');
        expect(fake.exits).toEqual([1]);
    });

    it('dispose removes the listeners', () => {
        const handlers = install();

        expect(fake.signals.listenerCount('SIGTERM')).toBe(1);
        expect(fake.signals.listenerCount('SIGINT')).toBe(1);
        handlers.dispose();
        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
        expect(fake.signals.listenerCount('SIGINT')).toBe(0);
    });

    it('removes the listeners after the stop settled', async () => {
        install();
        fake.signals.emit('SIGTERM');
        stop.resolve();
        await flush();
        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
    });
});
