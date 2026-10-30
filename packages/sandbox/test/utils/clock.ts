/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';

type Timer = {
    at: number;
    seq: number;
    fn: () => void;
};

/**
 * Manually advanced clock for the sandbox package's own tests. `@chamvi/test-kit` ships
 * the public one; this package cannot depend on the kit, which peers on it.
 */
export class ControllableClock implements IClock {
    protected current: number;

    protected timers: Timer[] = [];

    protected seq = 0;

    constructor(start: Date = new Date(0)) {
        this.current = start.getTime();
    }

    now(): Date {
        return new Date(this.current);
    }

    /** Clock options (keepAlive) have no meaning without a real event loop and are ignored. */
    setTimeout(fn: () => void, ms: number): { clear(): void } {
        const timer: Timer = {
            at: this.current + ms,
            seq: this.seq++,
            fn,
        };

        this.timers.push(timer);

        return {
            clear: () => {
                this.timers = this.timers.filter((t) => t !== timer);
            },
        };
    }

    /**
     * Move time forward, firing due timers in order (timers scheduled by
     * fired callbacks that fall within the window fire too).
     */
    advance(ms: number): void {
        const target = this.current + ms;

        for (;;) {
            const due = this.timers
                .filter((t) => t.at <= target)
                .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];

            if (!due) {
                break;
            }

            this.timers = this.timers.filter((t) => t !== due);
            this.current = Math.max(this.current, due.at);
            due.fn();
        }

        this.current = target;
    }
}
