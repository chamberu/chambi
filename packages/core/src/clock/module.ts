/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from './types.ts';

export const systemClock: IClock = {
    now: () => new Date(),
    setTimeout: (fn, ms, opts) => {
        const handle = setTimeout(fn, ms);

        // never keep the process alive just for engine timers, unless asked to
        if (!opts?.keepAlive) {
            handle.unref?.();
        }

        return { clear: () => clearTimeout(handle) };
    },
};
