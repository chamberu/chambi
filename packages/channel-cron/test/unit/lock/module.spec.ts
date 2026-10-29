/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ILockStore } from '@chamvi/core';
import { createMemoryStores } from '@chamvi/core';
import { createStoreScheduleLock } from '@chamvi/channel-cron';
import { ControllableClock } from '@chamvi/test-kit';

const setup = () => {
    const clock = new ControllableClock(new Date('2026-03-01T08:00:00.000Z'));
    const store = createMemoryStores({ clock });
    return { clock, stores: store };
};

describe('createStoreScheduleLock', () => {
    it('first acquirer of a tick wins', async () => {
        const { stores: store } = setup();
        const a = createStoreScheduleLock(store.locks, 'a');
        const b = createStoreScheduleLock(store.locks, 'b');

        expect(await a.acquire('cron:x:y:T', 600_000)).toBe(true);
        expect(await b.acquire('cron:x:y:T', 600_000)).toBe(false);
    });

    it('different ticks do not block each other', async () => {
        const { stores: store } = setup();
        const lock = createStoreScheduleLock(store.locks, 'a');

        expect(await lock.acquire('cron:x:y:T1', 600_000)).toBe(true);
        expect(await lock.acquire('cron:x:y:T2', 600_000)).toBe(true);
    });

    it('the lock is never released', async () => {
        const { clock, stores: store } = setup();
        const lock = createStoreScheduleLock(store.locks, 'a');
        const other = createStoreScheduleLock(store.locks, 'b');

        expect('release' in lock).toBe(false);
        expect(await lock.acquire('k', 600_000)).toBe(true);
        clock.advance(599_999);
        expect(await other.acquire('k', 600_000)).toBe(false);
        clock.advance(1);
        expect(await other.acquire('k', 600_000)).toBe(true);
    });

    it('passes the owner to the store', async () => {
        const calls: [string, string, number][] = [];
        const store: ILockStore = {
            async acquire(key, owner, ttlMs) {
                calls.push([key, owner, ttlMs]);
                return true;
            },
            release: () => Promise.resolve(),
        };

        await createStoreScheduleLock(store, 'replica-1').acquire('k', 1000);

        expect(calls).toEqual([['k', 'replica-1', 1000]]);
    });
});
