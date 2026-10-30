/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IExecTransport, TransportExecOptions } from '@chamvi/sandbox';

/** The options a fake exec sees, plus what the exec script was given. */
export type FakeExecOptions = TransportExecOptions & {
    /** The working directory the exec script enters. */
    cwd: string;
    /** The exit marker the exec script reports the exit with. */
    marker: string;
};

export type FakeExecAnswer = {
    exitCode?: number;
    stdout?: Uint8Array;
    stderr?: Uint8Array;
    /** false: report no exit marker (a command the transport ended before the script did). */
    marker?: boolean;
    /** true: the exec script found no cwd (marker `cwd`, exit 127). */
    cwdMissing?: boolean;
    /** true: the connection closed early (`TransportExecResult.closed`). */
    closed?: boolean;
};

export type FakeTransportHandler = (
    argv: readonly string[],
    options: FakeExecOptions,
) => FakeExecAnswer | Promise<FakeExecAnswer>;

export type FakeTransport = IExecTransport & {
    /** `argv` is what the exec script runs (from `timeout` on); `raw` is what the transport got. */
    calls: Array<{
        argv: string[];
        raw: string[];
        options: FakeExecOptions
    }>;
    /** How often remove() was called. */
    removed: number;
    /** The next remove() rejects with `error`. */
    failNextRemove(error: Error): void;
};

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * A transport that plays the exec script: it unwraps `sh -c <script> sh
 * <marker> <cwd> ...argv`, asks `handler` (default: exit 0, no output),
 * writes the answer's output to the sinks and then the exit marker to
 * stderr, as the script does. Every call is recorded. A handler may advance
 * a clock to simulate duration, write to the sinks itself, or return a
 * promise that never settles.
 */
export function createFakeTransport(handler: FakeTransportHandler = () => ({})): FakeTransport {
    let nextRemoveError: Error | undefined;
    const transport: FakeTransport = {
        calls: [],
        removed: 0,
        failNextRemove(error) {
            nextRemoveError = error;
        },
        async exec(raw, options) {
            const [, , , , marker = '', cwd = '', ...argv] = raw;
            const fake: FakeExecOptions = {
                ...options,
                cwd,
                marker,
            };

            transport.calls.push({
                argv,
                raw: [...raw],
                options: fake,
            });

            const answer = await handler(argv, fake);

            if (answer.cwdMissing) {
                options.stderr.write(encode(`${marker}cwd\n`));

                return { exitCode: 127 };
            }

            const exitCode = answer.exitCode ?? 0;

            if (answer.stdout) {
                options.stdout.write(answer.stdout);
            }

            if (answer.stderr) {
                options.stderr.write(answer.stderr);
            }

            if (answer.marker !== false) {
                options.stderr.write(encode(`${marker}${exitCode}\n`));
            }

            return answer.closed ? { exitCode, closed: true } : { exitCode };
        },
        async remove() {
            transport.removed++;

            if (!nextRemoveError) {
                return;
            }

            const error = nextRemoveError;

            nextRemoveError = undefined;

            throw error;
        },
    };

    return transport;
}
