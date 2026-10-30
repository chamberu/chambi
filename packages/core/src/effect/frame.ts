/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { isObject } from 'smob';
import type { ToolCallFrame } from './types.ts';

const storage = new AsyncLocalStorage<ToolCallFrame>();

/** Runs `fn` as the tool call `frame`: currentToolCall() returns it there and in what `fn` awaits. */
export function runToolCall<T>(frame: ToolCallFrame, fn: () => T): T {
    const result = storage.run(frame, fn);

    // a streaming tool's body runs when the AI SDK iterates it, outside the frame
    if (isObject(result) && Symbol.asyncIterator in result) {
        return bindIterable(frame, result as AsyncIterable<unknown>) as T;
    }

    return result;
}

/** The tool call the caller runs for, undefined outside one (e.g. in the tools factory). */
export function currentToolCall(): ToolCallFrame | undefined {
    return storage.getStore();
}

function bindIterable(frame: ToolCallFrame, iterable: AsyncIterable<unknown>): AsyncIterable<unknown> {
    return {
        [Symbol.asyncIterator]() {
            const iterator = storage.run(frame, () => iterable[Symbol.asyncIterator]());

            return {
                next: (...args: [] | [unknown]) => storage.run(frame, () => iterator.next(...args)),
                return: (value?: unknown) => storage.run(frame, () => (
                    iterator.return ? iterator.return(value) : Promise.resolve({ done: true as const, value })
                )),
                throw: (error?: unknown) => storage.run(frame, () => (
                    iterator.throw ? iterator.throw(error) : Promise.reject(error)
                )),
            };
        },
    };
}
