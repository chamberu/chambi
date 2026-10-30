/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryScheduleLock } from '@hubwire/test';
import type { IScheduledComponent, ScheduledComponentRunContext } from 'hubwire';
import { defineScheduledComponent } from 'hubwire';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { cron } from '@chamvi/channel-cron';

// pins the upstream contract @chamvi/channel-cron relies on (hubwire 0.2.2)
describe('hubwire scheduled component', () => {
    let components: IScheduledComponent[] = [];
    let lock: MemoryScheduleLock;

    const run = vi.fn<(ctx: ScheduledComponentRunContext) => Promise<void>>(async () => {});

    const start = async (component: IScheduledComponent) => {
        components.push(component);
        await component.start();

        return component;
    };

    beforeEach(() => {
        vi.useFakeTimers({ now: new Date('2026-03-01T07:59:30Z') });
        lock = new MemoryScheduleLock();
        run.mockClear();
    });

    afterEach(async () => {
        await Promise.all(components.map((c) => c.stop()));
        components = [];
        vi.useRealTimers();
    });

    it('two components sharing a lock run once per tick', async () => {
        const options = {
            name: 'job',
            schedule: '* * * * *',
            lock,
            runOnStart: false,
            run,
        };

        await start(defineScheduledComponent(options));
        await start(defineScheduledComponent(options));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(run).toHaveBeenCalledTimes(1);
        expect(lock.acquired.map((a) => a.key)).toEqual(['job:2026-03-01T08:00:00.000Z']);
    });

    it('passes the scheduled fire time', async () => {
        await start(defineScheduledComponent({
            name: 'job',
            schedule: '* * * * *',
            lock,
            run,
        }));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0]?.[0].scheduledAt.toISOString()).toBe('2026-03-01T08:00:00.000Z');
    });

    it('does not run on start with a lock', async () => {
        await start(defineScheduledComponent({
            name: 'job',
            schedule: '0 0 1 1 *',
            lock,
            run,
        }));

        expect(run).not.toHaveBeenCalled();
    });

    it('honours the timezone', async () => {
        const berlin = vi.fn<(ctx: ScheduledComponentRunContext) => Promise<void>>(async () => {});
        const utc = vi.fn<(ctx: ScheduledComponentRunContext) => Promise<void>>(async () => {});

        await start(defineScheduledComponent({
            name: 'berlin',
            schedule: '0 9 * * *',
            timezone: 'Europe/Berlin',
            lock,
            run: berlin,
        }));
        await start(defineScheduledComponent({
            name: 'utc',
            schedule: '0 9 * * *',
            timezone: 'UTC',
            lock,
            run: utc,
        }));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(berlin).toHaveBeenCalledTimes(1);
        expect(berlin.mock.calls[0]?.[0].scheduledAt.toISOString()).toBe('2026-03-01T08:00:00.000Z');
        expect(utc).not.toHaveBeenCalled();
    });

    it('reports a throwing lock to onError', async () => {
        const error = new Error('lock store down');

        lock.acquireError = error;

        const onError = vi.fn();

        await start(defineScheduledComponent({
            name: 'job',
            schedule: '* * * * *',
            lock,
            run,
            hooks: { onError },
        }));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(onError).toHaveBeenCalledWith(error);
        expect(run).not.toHaveBeenCalled();
    });

    it('a held tick is skipped without running', async () => {
        await lock.acquire('job:2026-03-01T08:00:00.000Z', 60_000);

        const onSkip = vi.fn();

        await start(defineScheduledComponent({
            name: 'job',
            schedule: '* * * * *',
            lock,
            run,
            hooks: { onSkip },
        }));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(run).not.toHaveBeenCalled();
        expect(onSkip).toHaveBeenCalledTimes(1);
        expect((onSkip.mock.calls[0]?.[0] as Date).toISOString()).toBe('2026-03-01T08:00:00.000Z');
    });

    it('rejects an invalid timezone at definition', () => {
        expect(() => defineScheduledComponent({
            schedule: '* * * * *',
            timezone: 'Mars/Base',
            run,
        })).toThrow();
    });

    it('requires a name with a lock', () => {
        expect(() => defineScheduledComponent({
            schedule: '* * * * *',
            lock,
            run,
        } as never)).toThrow();
    });

    it('rejects a non-positive lockTtlMs', () => {
        expect(() => defineScheduledComponent({
            name: 'job',
            schedule: '* * * * *',
            lock,
            lockTtlMs: 0,
            run,
        })).toThrow();
    });

    it('fires once at a doubled local time', async () => {
        vi.setSystemTime(new Date('2026-10-24T23:59:30Z'));
        await start(defineScheduledComponent({
            name: 'job',
            schedule: '0 2 * * *',
            timezone: 'Europe/Berlin',
            lock,
            run,
        }));

        await vi.advanceTimersByTimeAsync(2 * 3_600_000);

        expect(run.mock.calls.map(([ctx]) => ctx.scheduledAt.toISOString())).toEqual(['2026-10-25T00:00:00.000Z']);
    });

    it('fires a skipped local time an hour later', async () => {
        vi.setSystemTime(new Date('2026-03-28T23:59:30Z'));
        await start(defineScheduledComponent({
            name: 'job',
            schedule: '30 2 * * *',
            timezone: 'Europe/Berlin',
            lock,
            run,
        }));

        await vi.advanceTimersByTimeAsync(2 * 3_600_000);

        expect(run.mock.calls.map(([ctx]) => ctx.scheduledAt.toISOString())).toEqual(['2026-03-29T01:30:00.000Z']);
    });
});

describe('expression support', () => {
    it('rejects a weekday step on a range start', () => {
        expect(() => cron.on('0 0 * * 1/2')).not.toThrow();
        expect(() => defineScheduledComponent({ schedule: '0 0 * * 1/2', run: async () => {} })).toThrow();
    });
});
