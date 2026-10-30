/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { delay } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';

describe('delay', () => {
    it('resolves once the clock passed the wait', async () => {
        const clock = new ControllableClock();
        let done = false;
        const waiting = delay(clock, 100, undefined, () => new Error('aborted')).then(() => {
            done = true;
        });

        clock.advance(99);
        await Promise.resolve();
        expect(done).toBe(false);
        clock.advance(1);
        await waiting;
        expect(done).toBe(true);
    });

    it('rejects with the abort error when the signal fires first', async () => {
        const clock = new ControllableClock();
        const controller = new AbortController();
        const waiting = delay(clock, 100, controller.signal, () => new Error('stopped'));

        controller.abort();
        await expect(waiting).rejects.toThrow('stopped');
    });

    it('rejects at once for an aborted signal', async () => {
        const clock = new ControllableClock();

        await expect(delay(clock, 100, AbortSignal.abort(), () => new Error('stopped'))).rejects.toThrow('stopped');
    });
});
