/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomBytes } from 'node:crypto';
import { SandboxError, ValidationError, systemClock } from '@chamvi/core';
import { toSandboxError } from '../manager/helpers.ts';
import { createOutputCollector } from '../output/module.ts';
import { absoluteWorkspacePath, resolveWorkspacePath } from '../path/module.ts';
import {
    EXEC_TIMEOUT_MAX_MS,
    EXEC_TIMEOUT_MS,
    FILE_MAX_BYTES,
    OUTPUT_MAX_BYTES,
    WORKSPACE_ROOT,
} from '../workspace/constants.ts';
import { assertArgv, decodeUtf8File } from '../workspace/module.ts';
import type { ExecOptions, ExecResult, IWorkspace } from '../workspace/types.ts';
import {
    ALIVE_PROBE_TIMEOUT_MS,
    EXEC_GRACE_MS,
    EXIT_DRAIN_MS,
    EXIT_MARKER_CWD,
    WRITE_FILE_SCRIPT,
} from './constants.ts';
import {
    createExitMarkerFilter,
    decodeOutput,
    exitMarker,
    isTimeoutExit,
    stderrMessage,
    wrapExec,
    wrapTimeout,
} from './helpers.ts';
import type { RemoteWorkspaceInput, TransportExecResult } from './types.ts';

type RunInput = {
    cwd: string;
    stdin?: Uint8Array;
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
};

type RunResult = {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
    durationMs: number;
};

/**
 * A workspace in a container or pod, reached through `transport`. Every
 * command runs inside `EXEC_SCRIPT` (it enters the working directory, else
 * the exec rejects like on local, and reports the exit status on stderr)
 * behind GNU `timeout`. A command that exited while a background job holds
 * its output returns `EXIT_DRAIN_MS` after its exit with its exit code and
 * the output so far; a client-side guard stops waiting at the timeout plus
 * `EXEC_GRACE_MS` and reports exit 137 with the output so far. An abort only
 * detaches (the command runs on until its `timeout` or the dispose); a
 * dispose settles every in-flight exec with `SandboxError('workspace
 * disposed')` and removes the container or pod; a dispose after a failed
 * removal tries it again. A failed exec asks `transport.alive`: a container
 * or pod that no longer runs marks the workspace gone (`disposed`).
 */
export function createRemoteWorkspace(input: RemoteWorkspaceInput): IWorkspace {
    const {
        id,
        info,
        transport,
    } = input;
    const clock = input.clock ?? systemClock;
    const disposal = new AbortController();
    let disposed = false;
    let gone = false;
    let removing: Promise<void> | undefined;

    const goneMessage = (detail?: string): string => `workspace ${id} is gone (its container or pod stopped or was removed` +
        `${detail ? `: ${detail}` : ''}); call create_workspace for a new one.`;

    const assertUsable = () => {
        if (disposed) {
            throw new SandboxError('workspace disposed');
        }
        if (gone) {
            throw new SandboxError(goneMessage());
        }
        if (clock.now().getTime() >= info.expiresAt.getTime()) {
            throw new SandboxError('workspace expired');
        }
    };

    /** The requested timeout (default `EXEC_TIMEOUT_MS`), at most `EXEC_TIMEOUT_MAX_MS` and never past the expiry. */
    const timeoutOf = (requested: number | undefined): number => {
        if (requested !== undefined && (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0)) {
            throw new ValidationError('timeoutMs must be a positive number.');
        }
        const remaining = info.expiresAt.getTime() - clock.now().getTime();
        return Math.max(1, Math.min(requested ?? EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MAX_MS, remaining));
    };

    /** `transport.alive`, bounded by ALIVE_PROBE_TIMEOUT_MS; anything but a plain `false` reads as alive. */
    const probeAlive = (): Promise<boolean> => {
        const { alive } = transport;
        if (!alive) return Promise.resolve(true);
        const controller = new AbortController();
        return new Promise<boolean>((resolve) => {
            const timer = clock.setTimeout(() => {
                controller.abort();
                resolve(true);
            }, ALIVE_PROBE_TIMEOUT_MS);
            const answer = (value: boolean) => {
                timer.clear();
                resolve(value);
            };
            Promise.resolve()
                .then(() => alive.call(transport, controller.signal))
                .then((value) => answer(value !== false), () => answer(true));
        });
    };

    const run = (argv: readonly string[], options: RunInput): Promise<RunResult> => {
        const { signal, timeoutMs } = options;
        if (signal?.aborted) {
            return Promise.reject(new SandboxError('exec aborted'));
        }

        const started = clock.now().getTime();
        const guard = new AbortController();
        // the workspace settled the exec itself (the command exited, its output stays open)
        const detach = new AbortController();
        const combined = AbortSignal.any(signal ?
            [guard.signal, detach.signal, disposal.signal, signal] :
            [guard.signal, detach.signal, disposal.signal]);
        const stdout = createOutputCollector(options.maxOutputBytes);
        const stderr = createOutputCollector(options.maxOutputBytes);
        const marker = exitMarker();

        return new Promise<RunResult>((resolve, reject) => {
            let settled = false;
            /** When the exec script reported the exit. */
            let exitedAt: number | undefined;
            let drain: { clear(): void } | undefined;
            const timer = clock.setTimeout(() => guard.abort(), timeoutMs + EXEC_GRACE_MS);

            const finish = (): boolean => {
                if (settled) return false;
                settled = true;
                timer.clear();
                drain?.clear();
                combined.removeEventListener('abort', onAbort);
                return true;
            };
            /** The output collected so far (also after a guard or a drain). */
            const result = (exitCode: number, timedOut?: boolean): RunResult => {
                filter.flush();
                const durationMs = (exitedAt ?? clock.now().getTime()) - started;
                return {
                    exitCode,
                    stdout: stdout.bytes(),
                    stderr: stderr.bytes(),
                    stdoutTruncated: stdout.truncated,
                    stderrTruncated: stderr.truncated,
                    timedOut: timedOut ?? isTimeoutExit(exitCode, durationMs, timeoutMs),
                    durationMs,
                };
            };
            /** Settles by precedence: disposed, then aborted, then the guard. */
            const interrupted = (): boolean => {
                if (disposal.signal.aborted) {
                    reject(new SandboxError('workspace disposed'));
                    return true;
                }
                if (signal?.aborted) {
                    reject(new SandboxError('exec aborted'));
                    return true;
                }
                if (guard.signal.aborted) {
                    resolve(result(137, true));
                    return true;
                }
                return false;
            };
            function onAbort() {
                if (finish()) interrupted();
            }
            combined.addEventListener('abort', onAbort, { once: true });

            const filter = createExitMarkerFilter(marker, stderr, (value) => {
                if (settled) return;
                exitedAt = clock.now().getTime();
                if (value === EXIT_MARKER_CWD) {
                    if (!finish()) return;
                    detach.abort();
                    reject(new SandboxError(`cwd ${options.cwd} is no directory in the workspace.`));
                    return;
                }
                if (!/^\d{1,3}$/.test(value)) return;
                const exitCode = Number(value);
                // a background job may hold the output open: return after the drain
                drain = clock.setTimeout(() => {
                    if (!finish()) return;
                    detach.abort();
                    resolve(result(exitCode));
                }, EXIT_DRAIN_MS);
            });

            let pending: Promise<TransportExecResult>;
            try {
                pending = transport.exec(wrapExec(wrapTimeout(argv, timeoutMs), options.cwd, marker), {
                    stdin: options.stdin,
                    stdout,
                    stderr: filter,
                    signal: combined,
                });
            } catch (error) {
                pending = Promise.reject(error);
            }

            pending.then(({ exitCode, closed }) => {
                if (!finish() || interrupted()) return;
                if (closed && exitedAt === undefined) {
                    reject(new SandboxError('exec failed: the connection closed before the command reported its exit, so its output may be cut.'));
                    return;
                }
                resolve(result(exitCode));
            }, (error: unknown) => {
                if (!finish() || interrupted()) return;
                const failure = toSandboxError(error, 'exec failed');
                probeAlive().then((alive) => {
                    if (disposed) {
                        reject(new SandboxError('workspace disposed'));
                    } else if (alive) {
                        reject(failure);
                    } else {
                        gone = true;
                        reject(new SandboxError(goneMessage(failure.message), { cause: error }));
                    }
                });
            });
        });
    };

    return {
        id,
        info,

        get disposed() {
            return disposed || gone;
        },

        async exec(argv: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
            assertUsable();
            assertArgv(argv);
            const cwd = absoluteWorkspacePath(options.cwd === undefined ? '.' : resolveWorkspacePath(options.cwd));
            if (options.stdin !== undefined && typeof options.stdin !== 'string') {
                throw new ValidationError('stdin must be a string.');
            }
            const timeoutMs = timeoutOf(options.timeoutMs);

            const result = await run(argv, {
                cwd,
                stdin: options.stdin === undefined ? undefined : new TextEncoder().encode(options.stdin),
                timeoutMs,
                maxOutputBytes: OUTPUT_MAX_BYTES,
                signal: options.signal,
            });
            return {
                exitCode: result.exitCode,
                stdout: decodeOutput(result.stdout, result.stdoutTruncated),
                stderr: decodeOutput(result.stderr, result.stderrTruncated),
                stdoutTruncated: result.stdoutTruncated,
                stderrTruncated: result.stderrTruncated,
                timedOut: result.timedOut,
                durationMs: result.durationMs,
            };
        },

        async readFile(path: string): Promise<string> {
            assertUsable();
            const relative = resolveWorkspacePath(path);
            if (relative === '.') {
                throw new SandboxError(`${WORKSPACE_ROOT} is no file.`);
            }
            const file = absoluteWorkspacePath(relative);

            // one byte past the limit tells an oversized file apart
            const result = await run(['cat', '--', file], {
                cwd: WORKSPACE_ROOT,
                timeoutMs: timeoutOf(undefined),
                maxOutputBytes: FILE_MAX_BYTES + 1,
            });
            if (result.timedOut) {
                throw new SandboxError(`cannot read ${file}: timed out.`);
            }
            if (result.exitCode !== 0) {
                const stderr = stderrMessage(result.stderr);
                if (stderr.endsWith('No such file or directory')) {
                    throw new SandboxError(`file not found: ${file}`);
                }
                throw new SandboxError(`cannot read ${file}: cat exited with ${result.exitCode}${stderr ? `: ${stderr}` : ''}`);
            }
            if (result.stdoutTruncated || result.stdout.length > FILE_MAX_BYTES) {
                throw new SandboxError(`${file} is larger than the ${FILE_MAX_BYTES} bytes a file may have.`);
            }
            return decodeUtf8File(result.stdout, file);
        },

        async writeFile(path: string, content: string): Promise<void> {
            assertUsable();
            const relative = resolveWorkspacePath(path);
            if (relative === '.') {
                throw new ValidationError('path must name a file, not the workspace root.');
            }
            if (typeof content !== 'string') {
                throw new ValidationError('content must be a string.');
            }
            const bytes = new TextEncoder().encode(content);
            if (bytes.length > FILE_MAX_BYTES) {
                throw new ValidationError(`content has ${bytes.length} bytes, more than the ${FILE_MAX_BYTES} a file may have.`);
            }

            const file = absoluteWorkspacePath(relative);
            const temporary = randomBytes(8).toString('hex');
            const result = await run(['sh', '-c', WRITE_FILE_SCRIPT, 'sh', file, String(bytes.length), temporary], {
                cwd: WORKSPACE_ROOT,
                stdin: bytes,
                timeoutMs: timeoutOf(undefined),
                maxOutputBytes: OUTPUT_MAX_BYTES,
            });
            if (result.timedOut) {
                throw new SandboxError(`cannot write ${file}: timed out.`);
            }
            if (result.exitCode !== 0) {
                const stderr = stderrMessage(result.stderr);
                throw new SandboxError(`cannot write ${file}: exited with ${result.exitCode}${stderr ? `: ${stderr}` : ''}`);
            }
        },

        dispose(): Promise<void> {
            // settles every in-flight exec before the container goes
            disposed = true;
            disposal.abort();
            removing ??= Promise.resolve()
                .then(() => transport.remove())
                .catch((error: unknown) => {
                    // a later dispose tries the removal again
                    removing = undefined;
                    throw toSandboxError(error, `cannot remove workspace ${id}`);
                });
            return removing;
        },
    };
}
