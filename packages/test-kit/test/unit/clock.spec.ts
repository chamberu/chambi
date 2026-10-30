/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ControllableClock } from '@chamvi/test-kit';

describe('ControllableClock', () => {
    it('starts at the given date', () => {
        expect(new ControllableClock(new Date(5)).now().getTime()).toBe(5);
    });

    it('fires due timers in order while advancing', () => {
        const clock = new ControllableClock();
        const fired: string[] = [];

        clock.setTimeout(() => {
            fired.push('b');
        }, 20);
        clock.setTimeout(() => {
            fired.push('a');
        }, 10);
        clock.advance(15);
        expect(fired).toEqual(['a']);
        expect(clock.now().getTime()).toBe(15);
        clock.advance(5);
        expect(fired).toEqual(['a', 'b']);
    });

    it('fires timers scheduled by a fired timer within the window', () => {
        const clock = new ControllableClock();
        const fired: number[] = [];

        clock.setTimeout(() => {
            fired.push(clock.now().getTime());
            clock.setTimeout(() => {
                fired.push(clock.now().getTime());
            }, 5);
        }, 10);
        clock.advance(20);
        expect(fired).toEqual([10, 15]);
    });

    it('does not fire a cleared timer', () => {
        const clock = new ControllableClock();
        let fired = false;

        clock.setTimeout(() => {
            fired = true;
        }, 10).clear();
        clock.advance(10);
        expect(fired).toBe(false);
    });
});
