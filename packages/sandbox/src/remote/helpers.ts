/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { completeLength } from '../output/helpers.ts';
import type { IOutputSink } from '../output/types.ts';
import { ERROR_STDERR_MAX_LENGTH, EXEC_SCRIPT, TIMEOUT_KILL_AFTER_SECONDS } from './constants.ts';

/**
 * `argv` behind `timeout -k 5 <seconds>`: GNU `timeout` signals the
 * command's whole process group, BusyBox `timeout` the command alone. Seconds of the timeout rounded up to whole
 * milliseconds, without trailing zeros (`1500` -> `'1.5'`).
 */
export function wrapTimeout(argv: readonly string[], timeoutMs: number): string[] {
    return [
        'timeout',
        '-k',
        String(TIMEOUT_KILL_AFTER_SECONDS),
        String(Math.ceil(timeoutMs) / 1000),
        ...argv,
    ];
}

/**
 * Whether `timeout` ended the command once the timeout passed: exit 124
 * (GNU `timeout` after its TERM), 137 (KILL after the grace) or 143 (the
 * command's own death by TERM, as BusyBox `timeout` execs the command and
 * signals it alone). A command exiting so by itself before that is no
 * timeout.
 */
export function isTimeoutExit(exitCode: number, durationMs: number, timeoutMs: number): boolean {
    return (exitCode === 124 || exitCode === 137 || exitCode === 143) && durationMs >= timeoutMs;
}

/** UTF-8 text of `bytes`; a sequence the cap cut short is dropped. */
export function decodeOutput(bytes: Uint8Array, truncated: boolean): string {
    return new TextDecoder().decode(truncated ? bytes.subarray(0, completeLength(bytes)) : bytes);
}

/** The trimmed stderr of a failed command for an error message, at most `ERROR_STDERR_MAX_LENGTH`. */
export function stderrMessage(stderr: Uint8Array): string {
    return new TextDecoder().decode(stderr).trim().slice(0, ERROR_STDERR_MAX_LENGTH);
}

/** A fresh marker for one exec: nobody else can print it. */
export function exitMarker(): string {
    return `chamvi-exit-${randomBytes(16).toString('hex')}:`;
}

/** `argv` inside `EXEC_SCRIPT`: run in `cwd`, the exit reported as `marker` on stderr. */
export function wrapExec(argv: readonly string[], cwd: string, marker: string): string[] {
    return ['sh', '-c', EXEC_SCRIPT, 'sh', marker, cwd, ...argv];
}

/** How many trailing bytes of `buffer` start `head` (fewer than all of it). */
function partialSuffix(buffer: Buffer, head: Buffer): number {
    for (let length = Math.min(buffer.length, head.length - 1); length > 0; length--) {
        if (buffer.subarray(buffer.length - length).equals(head.subarray(0, length))) return length;
    }
    return 0;
}

/**
 * A stderr sink that cuts the first `marker` line out of the stream and
 * hands its value (the text between the marker and the newline) to
 * `onMarker`; every other byte goes to `sink`, in order. A marker split
 * across chunks is held back until it is complete; `flush` passes on what
 * is held back once the stream is done.
 */
export function createExitMarkerFilter(
    marker: string,
    sink: IOutputSink,
    onMarker: (value: string) => void,
): IOutputSink & { flush(): void } {
    const head = Buffer.from(marker);
    let held: Buffer | undefined;
    let found = false;
    const pass = (bytes: Uint8Array) => {
        if (bytes.length > 0) sink.write(bytes);
    };

    return {
        write(chunk) {
            if (found) {
                pass(chunk);
                return;
            }
            const buffer = held ?
                Buffer.concat([held, chunk]) :
                Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            held = undefined;

            const start = buffer.indexOf(head);
            if (start === -1) {
                const keep = partialSuffix(buffer, head);
                pass(buffer.subarray(0, buffer.length - keep));
                if (keep > 0) held = Buffer.from(buffer.subarray(buffer.length - keep));
                return;
            }
            pass(buffer.subarray(0, start));
            const end = buffer.indexOf(0x0A, start + head.length);
            if (end === -1) {
                held = Buffer.from(buffer.subarray(start));
                return;
            }
            found = true;
            const value = buffer.toString('latin1', start + head.length, end);
            pass(buffer.subarray(end + 1));
            onMarker(value);
        },
        flush() {
            if (!held) return;
            const rest = held;
            held = undefined;
            pass(rest);
        },
    };
}
