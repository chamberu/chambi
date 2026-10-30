/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { EXIT_CODE } from '../run/constants.ts';
import { messageOf } from '../run/helpers.ts';
import { SIGNAL_REPEAT_MS } from './constants.ts';
import type {
    SignalHandlers,
    SignalHandlersInput,
    StopSignal,
} from './types.ts';

const SIGNALS: readonly StopSignal[] = ['SIGTERM', 'SIGINT'];

/**
 * C5: the first SIGTERM or SIGINT calls `stop()` and sets exit code 0, or 1
 * when it rejects; a second signal, or `forceExitMs` without a settled stop,
 * exits 1 at once. A signal within `SIGNAL_REPEAT_MS` of the first is the
 * same one delivered twice and ignored. The listeners are removed once the
 * stop settled.
 */
export function installSignalHandlers(input: SignalHandlersInput): SignalHandlers {
    let signalled = false;
    let firstAt = 0;
    const listeners = new Map<StopSignal, () => void>();

    const dispose = () => {
        listeners.forEach((fn, signal) => input.target.off(signal, fn));
        listeners.clear();
    };

    const onSignal = (signal: StopSignal) => {
        if (signalled) {
            if (input.clock.now().getTime() - firstAt >= SIGNAL_REPEAT_MS) {
                input.exit(EXIT_CODE.FAILURE);
            }

            return;
        }

        signalled = true;
        firstAt = input.clock.now().getTime();

        input.stderr(`received ${signal}, stopping (again to force)\n`);

        // keeps the process alive: a stop stalled on a promise without a live handle still ends in exit 1;
        // cleared once the stop settled, so a clean stop lets Node exit
        const timer = input.clock.setTimeout(() => {
            input.stderr('forced exit\n');
            input.exit(EXIT_CODE.FAILURE);
        }, input.forceExitMs, { keepAlive: true });

        input.stop().then(
            () => input.setExitCode(EXIT_CODE.OK),
            (error: unknown) => {
                input.stderr(`stop failed: ${messageOf(error)}\n`);
                input.setExitCode(EXIT_CODE.FAILURE);
            },
        ).finally(() => {
            timer.clear();
            dispose();
        });
    };

    SIGNALS.forEach((signal) => {
        const fn = () => onSignal(signal);

        listeners.set(signal, fn);
        input.target.on(signal, fn);
    });

    return {
        get signalled() {
            return signalled;
        },
        dispose,
    };
}
