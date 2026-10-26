/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Duplex } from 'node:stream';

/** An error naming the abort, for the remote workspace to map by its precedence. */
export function abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('exec aborted');
}

/** Socket errors of a connection the daemon closed, e.g. after a command exited with stdin still queued. */
const CLOSED_CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE']);

/**
 * Resolves when the hijacked stream ends or closes (`'ended'`), or the daemon
 * closed the connection (ECONNRESET, EPIPE: `'closed'`, the exit code comes
 * from inspect but the output may be cut); rejects on any other error or the
 * signal.
 */
export function streamEnded(stream: Duplex, signal: AbortSignal): Promise<'ended' | 'closed'> {
    return new Promise<'ended' | 'closed'>((resolve, reject) => {
        const cleanup = () => {
            signal.removeEventListener('abort', onAbort);
            stream.off('end', onEnd);
            stream.off('close', onEnd);
            stream.off('error', onError);
        };
        function onEnd() {
            cleanup();
            resolve('ended');
        }
        function onError(error: Error & { code?: string }) {
            cleanup();
            if (error.code !== undefined && CLOSED_CONNECTION_CODES.has(error.code)) resolve('closed');
            else reject(error);
        }
        function onAbort() {
            cleanup();
            stream.destroy();
            reject(abortError(signal));
        }
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        stream.on('end', onEnd);
        stream.on('close', onEnd);
        stream.on('error', onError);
    });
}
