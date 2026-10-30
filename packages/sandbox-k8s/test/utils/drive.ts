/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ControllableClock } from '@chamvi/test-kit';

/** Lets already-queued callbacks settle; not a sleep. */
export const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

/**
 * Advances `clock` by `stepMs` between flushes until `promise` settles (at
 * most `maxSteps` times), then returns it.
 */
export async function drive<T>(
    promise: Promise<T>,
    clock: ControllableClock,
    stepMs: number,
    maxSteps = 500,
): Promise<T> {
    let done = false;

    promise.then(() => {
        done = true;
    }, () => {
        done = true;
    });

    for (let i = 0; i < maxSteps; i++) {
        await flush();

        if (done) {
            break;
        }

        clock.advance(stepMs);
    }

    return promise;
}
