/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Writable } from 'node:stream';
import { completeLength } from './helpers.ts';
import type { IOutputCollector, IOutputSink } from './types.ts';

export function createOutputCollector(maxBytes: number): IOutputCollector {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    const decoder = new TextDecoder();

    const bytes = (): Uint8Array => {
        const out = new Uint8Array(size);
        let offset = 0;

        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }

        return out;
    };

    return {
        write(chunk) {
            const room = maxBytes - size;

            if (chunk.length > room) {
                truncated = true;
            }

            const kept = Math.min(room, chunk.length);

            if (kept <= 0) {
                return;
            }

            // A copy, also for a Buffer, whose slice() is a view of the caller's memory.
            chunks.push(new Uint8Array(chunk.subarray(0, kept)));
            size += kept;
        },
        get truncated() {
            return truncated;
        },
        bytes,
        text() {
            const all = bytes();

            return decoder.decode(truncated ? all.subarray(0, completeLength(all)) : all);
        },
    };
}

/** A stream that hands every chunk to the sink and never applies backpressure. */
export function createSinkStream(sink: IOutputSink): Writable {
    return new Writable({
        write(chunk: Uint8Array, _encoding, callback) {
            sink.write(chunk);
            callback();
        },
    });
}
