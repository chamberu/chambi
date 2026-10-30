/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ApiError } from '../api/error.ts';
import type { RunWire, StepWire } from '../api/types.ts';
import {
    FATAL_STREAM_STATUSES,
    RECONNECT_DELAYS_MS,
    SETTLED_RUN_STATUSES,
} from './constants.ts';
import { sleep as defaultSleep, parseEventStream } from './helpers.ts';
import type {
    IRunStream,
    RunStreamEvent,
    RunStreamOptions,
    SseEvent,
} from './types.ts';

function toRunStreamEvent(event: SseEvent): RunStreamEvent | undefined {
    switch (event.event) {
        case 'run.updated':
            return { type: 'run', run: JSON.parse(event.data) as RunWire };
        case 'step.appended':
            return { type: 'step', step: JSON.parse(event.data) as StepWire };
        case 'delta': {
            const delta = JSON.parse(event.data) as {
                step: number;
                kind: 'text' | 'reasoning';
                text: string
            };

            return {
                type: 'delta',
                step: delta.step,
                kind: delta.kind,
                text: delta.text,
            };
        }
        default:
            return undefined;
    }
}

/**
 * Follows `GET /runs/:id/stream` with the bearer header (no EventSource):
 * after a drop it reconnects with the last step index seen as
 * `Last-Event-ID` (backoff `RECONNECT_DELAYS_MS`, a 503 waits its
 * `Retry-After`), so no step is lost or repeated; a stream that ends after
 * a settled run calls `onSettled`; 400, 401, 403 and 404 stop and go to
 * `onError`. `close()` aborts the open request.
 */
export function openRunStream(options: RunStreamOptions): IRunStream {
    const controller = new AbortController();
    const { signal } = controller;
    const wait = options.sleep ?? defaultSleep;
    let lastStep = options.after;

    void (async () => {
        let attempt = 0;

        while (!signal.aborted) {
            let settled = false;
            let delay: number | undefined;

            try {
                const response = await options.client.streamRun(options.runId, { lastEventId: lastStep, signal });

                if (!response.body) {
                    throw new ApiError(response.status, 'empty_stream', 'The stream has no body.');
                }

                for await (const event of parseEventStream(response.body)) {
                    if (signal.aborted) {
                        return;
                    }

                    const runEvent = toRunStreamEvent(event);

                    if (!runEvent) {
                        continue;
                    }

                    attempt = 0;

                    if (runEvent.type === 'step') {
                        lastStep = Math.max(lastStep ?? -1, (runEvent.step as StepWire).index);
                    }

                    if (runEvent.type === 'run') {
                        settled = SETTLED_RUN_STATUSES.includes(runEvent.run.status);
                    }

                    options.onEvent(runEvent);
                }
            } catch (error) {
                if (signal.aborted) {
                    return;
                }

                if (error instanceof ApiError) {
                    if (FATAL_STREAM_STATUSES.includes(error.status)) {
                        options.onError?.(error);

                        return;
                    }

                    if ((error.status === 503 || error.status === 429) && error.retryAfter !== undefined) {
                        delay = error.retryAfter * 1000;
                    }
                }

                settled = false;
            }

            if (signal.aborted) {
                return;
            }

            if (settled) {
                options.onSettled?.();

                return;
            }

            delay ??= RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
            attempt++;
            await wait(delay, signal);
        }
    })();

    return { close: () => controller.abort() };
}
