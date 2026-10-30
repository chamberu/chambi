/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ControllableClock } from '@chamvi/test-kit';
import { expect, it } from 'vitest';
import { createPurgeTimer } from '../../../../src/modules/repository/purge.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';

const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

it('waits for every capability purge after one fails, before stopping or rearming', async () => {
    const clock = new ControllableClock();
    const logger = createRecordingLogger(clock);
    const first = Promise.withResolvers<number>();
    const second = Promise.withResolvers<number>();
    let calls = 0;
    const timer = createPurgeTimer({
        repositories: [
            {
                purgeExpired: () => {
                    calls++;

                    return first.promise;
                },
            },
            {
                purgeExpired: () => {
                    calls++;

                    return second.promise;
                },
            },
        ],
        clock,
        logger,
        intervalMs: 100,
    });

    timer.start();
    clock.advance(100);
    expect(calls).toBe(2);
    first.reject(new Error('first failed'));
    await flush();
    clock.advance(500);
    expect(calls).toBe(2);

    let stopped = false;
    const stopping = timer.stop().then(() => {
        stopped = true;
    });

    await flush();
    expect(stopped).toBe(false);
    second.resolve(3);
    await stopping;
    expect(stopped).toBe(true);
    expect(logger.entries.filter((entry) => entry.level === 'error')).toHaveLength(1);
    clock.advance(500);
    expect(calls).toBe(2);
});
