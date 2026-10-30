/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IPurgeTimer, PurgeTimerOptions } from './types.ts';

/**
 * Runs each store's `purgeExpired()` every `intervalMs` on the clock. The next call
 * is armed only after the previous one settled, so calls never overlap.
 */
export function createPurgeTimer(options: PurgeTimerOptions): IPurgeTimer {
    const {
        repositories,
        clock,
        intervalMs,
        logger,
    } = options;
    let timer: { clear(): void } | undefined;
    let stopped = false;
    let inFlight: Promise<void> | undefined;

    const arm = () => {
        if (stopped) {
            return;
        }

        timer = clock.setTimeout(() => {
            timer = undefined;
            inFlight = Promise.all(repositories.map(async (store) => {
                try {
                    return await store.purgeExpired();
                } catch (error) {
                    logger.error('Purging expired store records failed.', error);
                    return undefined;
                }
            }))
                .then((results) => {
                    logger.debug('Purged expired store records.', { results });
                })
                .finally(() => {
                    inFlight = undefined;
                    arm();
                });
        }, intervalMs, { keepAlive: false });
    };

    return {
        start() {
            if (stopped || timer) {
                return;
            }

            arm();
        },
        async stop() {
            stopped = true;
            timer?.clear();
            timer = undefined;
            await inFlight;
        },
    };
}
