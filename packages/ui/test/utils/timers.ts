/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Timers that fire only when the test says so. */
export function createFakeTimers() {
    let next = 1;
    const pending = new Map<number, { fn: () => void; ms: number }>();

    return {
        timers: {
            set: ((fn: () => void, ms: number) => {
                const id = next++;

                pending.set(id, { fn, ms });

                return id;
            }) as unknown as typeof setTimeout,
            clear: ((id: number) => {
                pending.delete(id);
            }) as unknown as typeof clearTimeout,
        },
        pending: () => pending.values().toArray().map((p) => p.ms),
        /** Fires every pending timer once. */
        fire(): void {
            const due = pending.entries().toArray();

            pending.clear();

            for (const [, timer] of due) {
                timer.fn();
            }
        },
    };
}

export function flush(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
