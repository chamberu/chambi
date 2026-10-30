/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from '@chamvi/core';
import { WEB_REQUEST_ERROR_CODE } from './constants.ts';

/** A failed request as a tool error (code `web_request`). */
export function requestError(message: string): ChamviError {
    return new ChamviError({ message, code: WEB_REQUEST_ERROR_CODE });
}

/** An error's message (its `code` for a bare system error). */
export function messageOf(error: unknown): string {
    if (Error.isError(error)) {
        const { cause } = (error as { cause?: unknown });
        const message = error.message || String((error as { code?: unknown }).code ?? error.name);

        return Error.isError(cause) && cause.message && !message.includes(cause.message) ? `${message} (${cause.message})` : message;
    }

    return String(error);
}

/** Reads `body` up to `max` bytes; `truncated` when more followed (the rest is cancelled). */
export async function readCapped(
    body: ReadableStream<Uint8Array> | null | undefined,
    max: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    if (!body) {
        return { bytes: new Uint8Array(0), truncated: false };
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let truncated = false;

    try {
        for (;;) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            const room = max - length;

            if (value.byteLength > room) {
                chunks.push(value.subarray(0, room));
                length = max;
                truncated = true;

                break;
            }

            chunks.push(value);
            length += value.byteLength;
        }
    } finally {
        if (truncated) {
            await reader.cancel().catch(() => undefined);
        }

        reader.releaseLock();
    }

    const bytes = new Uint8Array(length);
    let at = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
    }

    return { bytes, truncated };
}
