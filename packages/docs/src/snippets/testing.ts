import { createMemoryStores } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';

export async function leaseExpiry() {
    // #region clock
    const clock = new ControllableClock(new Date('2026-01-01T00:00:00Z'));
    const store = createMemoryStores({ clock });

    await store.locks.acquire('job', 'replica-a', 1_000); // true
    await store.locks.acquire('job', 'replica-b', 1_000); // false, held by replica-a

    clock.advance(1_000); // a lease expires at exactly T + ttlMs
    await store.locks.acquire('job', 'replica-b', 1_000); // true
    // #endregion clock
}
