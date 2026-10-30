/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { documentVisibility } from './helpers.ts';
import type {
    IPageVisibility,
    IPoller,
    PollerTimers,
} from './types.ts';

/**
 * Runs `run` now and then `intervalMs` after each run settled, never two
 * at once; a failed run is ignored (the caller keeps its own error state).
 * A tick that comes due while the page is hidden waits until it is shown
 * again (a background tab sends nothing); `refresh()` always runs.
 * A run that resolves to a number waits that many ms (at least `intervalMs`)
 * before the next tick, e.g. a 429's `Retry-After`.
 */
export function createPoller(
    run: () => Promise<number | void>,
    intervalMs: number,
    timers?: PollerTimers,
    visibility: IPageVisibility | undefined = documentVisibility(),
): IPoller {
    const set = timers?.set ?? setTimeout;
    const clear = timers?.clear ?? clearTimeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<void> | undefined;
    let active = false;
    let deferred = false;
    let unsubscribe: (() => void) | undefined;

    const cancelTimer = () => {
        if (timer !== undefined) {
            clear(timer);
        }

        timer = undefined;
    };

    const tick = (): Promise<void> => {
        cancelTimer();
        deferred = false;

        if (inflight) {
            return inflight;
        }

        inflight = (async () => {
            let delay = intervalMs;

            try {
                const next = await run();

                if (typeof next === 'number' && next > delay) {
                    delay = next;
                }
            } catch {
                // the next tick tries again
            } finally {
                inflight = undefined;

                if (active) {
                    timer = set(due, delay);
                }
            }
        })();

        return inflight;
    };

    function due(): void {
        timer = undefined;

        if (visibility?.hidden()) {
            deferred = true;

            return;
        }

        void tick();
    }

    return {
        start() {
            if (active) {
                return;
            }

            active = true;
            unsubscribe = visibility?.onChange(() => {
                if (!active || !deferred || visibility.hidden()) {
                    return;
                }

                deferred = false;
                void tick();
            });
            void tick();
        },
        stop() {
            active = false;
            deferred = false;
            cancelTimer();
            unsubscribe?.();
            unsubscribe = undefined;
        },
        async refresh() {
            if (inflight) {
                await inflight;
            }

            await tick();
        },
    };
}
