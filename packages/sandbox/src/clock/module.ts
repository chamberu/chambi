/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';

/**
 * Waits `ms` on the clock. Rejects with `abortError()` when the signal is
 * aborted already or fires first (the timer is cleared).
 */
export function delay(
    clock: IClock,
    ms: number,
    signal: AbortSignal | undefined,
    abortError: () => Error,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());

            return;
        }

        const timer = clock.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        function onAbort() {
            timer.clear();
            reject(abortError());
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
