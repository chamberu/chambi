/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createPoller } from '../../../../app/polling/module.ts';
import { createFakeTimers, flush } from '../../../utils/timers.ts';

describe('createPoller', () => {
    it('does not overlap runs', async () => {
        const fake = createFakeTimers();
        let running = 0;
        let maxRunning = 0;
        let calls = 0;
        const gates: Array<() => void> = [];
        const poller = createPoller(async () => {
            calls++;
            running++;
            maxRunning = Math.max(maxRunning, running);
            await new Promise<void>((resolve) => {
                gates.push(resolve);
            });
            running--;
        }, 5000, fake.timers);

        poller.start();
        expect(calls).toBe(1);
        expect(fake.pending()).toEqual([]); // the next tick waits for this one

        const refreshed = poller.refresh();

        expect(calls).toBe(1);
        gates.shift()!();
        await flush();
        expect(calls).toBe(2); // the refresh ran after the first settled
        gates.shift()!();
        await refreshed;
        await flush();
        expect(fake.pending()).toEqual([5000]);
        fake.fire();
        expect(calls).toBe(3);
        gates.shift()!();
        await flush();
        expect(maxRunning).toBe(1);
        poller.stop();
    });

    it('keeps polling after a failed run', async () => {
        const fake = createFakeTimers();
        let calls = 0;
        const poller = createPoller(async () => {
            calls++;

            throw new Error('boom');
        }, 1000, fake.timers);

        poller.start();
        await flush();
        expect(fake.pending()).toEqual([1000]);
        fake.fire();
        await flush();
        expect(calls).toBe(2);
        poller.stop();
    });

    it('waits a returned delay longer than the interval before the next tick', async () => {
        const fake = createFakeTimers();
        const delays = [30_000, 10, undefined];
        const poller = createPoller(async () => delays.shift(), 1000, fake.timers);

        poller.start();
        await flush();
        expect(fake.pending()).toEqual([30_000]);
        fake.fire();
        await flush();
        expect(fake.pending()).toEqual([1000]); // a shorter delay keeps the interval
        fake.fire();
        await flush();
        expect(fake.pending()).toEqual([1000]);
        poller.stop();
    });

    it('stop cancels the next tick', async () => {
        const fake = createFakeTimers();
        let calls = 0;
        const poller = createPoller(async () => {
            calls++;
        }, 1000, fake.timers);

        poller.start();
        await flush();
        expect(fake.pending()).toEqual([1000]);
        poller.stop();
        expect(fake.pending()).toEqual([]);
        fake.fire();
        expect(calls).toBe(1);
    });

    it('stop during a run schedules nothing after it', async () => {
        const fake = createFakeTimers();
        const { promise, resolve: release } = Promise.withResolvers<void>();
        const poller = createPoller(() => promise, 1000, fake.timers);

        poller.start();
        poller.stop();
        release();
        await flush();
        expect(fake.pending()).toEqual([]);
    });

    it('holds a tick that came due while the page is hidden until it is shown', async () => {
        const fake = createFakeTimers();
        let hidden = false;
        const listeners = new Set<() => void>();
        const visibility = {
            hidden: () => hidden,
            onChange: (fn: () => void) => {
                listeners.add(fn);

                return () => {
                    listeners.delete(fn);
                };
            },
        };
        const change = (value: boolean) => {
            hidden = value;

            for (const fn of listeners) {
                fn();
            }
        };
        let calls = 0;
        const poller = createPoller(async () => {
            calls++;
        }, 5000, fake.timers, visibility);

        poller.start();
        await flush();
        expect(calls).toBe(1);

        change(true);
        fake.fire();
        await flush();
        expect(calls).toBe(1); // hidden: nothing sent
        expect(fake.pending()).toEqual([]);

        change(false);
        await flush();
        expect(calls).toBe(2); // shown again: polls at once, then on its interval
        expect(fake.pending()).toEqual([5000]);

        await poller.refresh();
        expect(calls).toBe(3);
        poller.stop();
        expect(listeners.size).toBe(0);
        change(true);
        change(false);
        await flush();
        expect(calls).toBe(3);
    });
});
