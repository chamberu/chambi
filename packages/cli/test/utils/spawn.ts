/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Env } from '@chamvi/app';

/** The built bin; the bin specs need `npx nx run @chamvi/cli:build` first. */
export const CLI_BIN = fileURLToPath(new URL('../../dist/cli.mjs', import.meta.url));

export const fixtureEntry = (name: string) => fileURLToPath(new URL(`../fixtures/${name}/src/index.ts`, import.meta.url));

export type Exit = { code: number | null; signal: NodeJS.Signals | null };

export type CliProcess = {
    child: ChildProcess;
    /** Everything written so far. */
    stdout(): string;
    stderr(): string;
    /** Resolves once `predicate` holds for stdout plus stderr, rejects after `timeoutMs`. */
    waitForOutput(predicate: (output: string) => boolean, timeoutMs?: number): Promise<void>;
    /** Resolves with the exit, rejects after `timeoutMs`. */
    exited(timeoutMs?: number): Promise<Exit>;
    /** Kills the process (its group when detached) unless it ended. */
    kill(): void;
};

export type SpawnCliInput = {
    cwd?: string;
    env?: Env;
    /** A process group of its own, so a test can signal the group like a terminal. */
    detached?: boolean;
};

function rejectAfter(timeoutMs: number, what: string, output: () => string): { promise: Promise<never>; clear(): void } {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms waiting for ${what}:\n${output()}`)), timeoutMs);
    });

    return { promise, clear: () => clearTimeout(timer) };
}

/**
 * Spawns `node dist/cli.mjs <args>` with only PATH and HOME of this
 * process's env plus `env` (real process, the documented exception to the
 * IClock rule).
 */
export function spawnCli(args: string[], input: SpawnCliInput = {}): CliProcess {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
        cwd: input.cwd ?? process.cwd(),
        env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            ...input.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: input.detached === true,
    });

    let stdout = '';
    let stderr = '';
    const waiters = new Set<() => void>();
    const notify = () => waiters.forEach((fn) => fn());

    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        notify();
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
        notify();
    });

    const exit = new Promise<Exit>((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    let ended = false;

    exit.then(() => {
        ended = true;
    });

    const output = () => `${stdout}${stderr}`;

    return {
        child,
        stdout: () => stdout,
        stderr: () => stderr,
        async waitForOutput(predicate, timeoutMs = 20_000) {
            if (predicate(output())) {
                return;
            }

            const timeout = rejectAfter(timeoutMs, 'output', output);
            let check: (() => void) | undefined;

            try {
                await Promise.race([
                    timeout.promise,
                    new Promise<void>((resolve, reject) => {
                        check = () => {
                            if (predicate(output())) {
                                resolve();
                            }
                        };
                        waiters.add(check);
                        exit.then(() => reject(new Error(`exited before the output appeared:\n${output()}`)));
                    }),
                ]);
            } finally {
                timeout.clear();

                if (check) {
                    waiters.delete(check);
                }
            }
        },
        async exited(timeoutMs = 20_000) {
            const timeout = rejectAfter(timeoutMs, 'the exit', output);

            try {
                return await Promise.race([exit, timeout.promise]);
            } finally {
                timeout.clear();
            }
        },
        kill() {
            if (ended || typeof child.pid !== 'number') {
                return;
            }

            try {
                if (input.detached) {
                    process.kill(-child.pid, 'SIGKILL');
                } else {
                    child.kill('SIGKILL');
                }
            } catch {
                // already gone
            }
        },
    };
}

/** Polls `url` until it answers 200, rejects after `timeoutMs`. */
export async function waitForOk(url: string, timeoutMs = 20_000): Promise<void> {
    const until = Date.now() + timeoutMs;

    for (;;) {
        try {
            const response = await fetch(url);

            if (response.status === 200) {
                return;
            }
        } catch {
            // not listening yet
        }

        if (Date.now() > until) {
            throw new Error(`${url} did not answer 200 within ${timeoutMs}ms`);
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 100);
        });
    }
}

export function count(text: string, needle: string): number {
    return text.split(needle).length - 1;
}
