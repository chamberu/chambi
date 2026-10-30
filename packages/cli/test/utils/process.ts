/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { EventEmitter } from 'node:events';
import type { Env } from '@chamvi/app';
import { ControllableClock } from '@chamvi/test-kit';
import type { CliContext } from '../../src/run/types.ts';
import type { ISignalTarget, ProcessEvent } from '../../src/signals/types.ts';

export type FakeProcess = {
    /** An EventEmitter-backed signal target: `emit('SIGTERM')` delivers a signal, `emit('exit')` the process exit. */
    signals: ISignalTarget & { emit(event: ProcessEvent): void; listenerCount(event: string): number };
    clock: ControllableClock;
    /** Every setExitCode call, in order. */
    exitCodes: number[];
    /** Every exit call, in order. */
    exits: number[];
    stdout: string[];
    stderr: string[];
    /** How often a command linked to its `chamvi dev` parent (`linkToParent`). */
    links: number;
    /** The CliContext over this process (env, cwd and importModule as given). */
    context(input?: { env?: Env; cwd?: string }): Partial<CliContext>;
};

export function createFakeProcess(): FakeProcess {
    const emitter = new EventEmitter();
    const clock = new ControllableClock();
    const exitCodes: number[] = [];
    const exits: number[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    const signals: FakeProcess['signals'] = {
        on(event, fn) {
            emitter.on(event, fn);
        },
        off(event, fn) {
            emitter.off(event, fn);
        },
        emit(event) {
            emitter.emit(event);
        },
        listenerCount(event) {
            return emitter.listenerCount(event);
        },
    };

    const fake: FakeProcess = {
        signals,
        clock,
        exitCodes,
        exits,
        stdout,
        stderr,
        links: 0,
        context(input = {}) {
            return {
                cwd: input.cwd ?? process.cwd(),
                env: input.env ?? {},
                clock,
                signals,
                setExitCode: (code) => {
                    exitCodes.push(code);
                },
                exit: (code) => {
                    exits.push(code);
                },
                stdout: (text) => {
                    stdout.push(text);
                },
                stderr: (text) => {
                    stderr.push(text);
                },
                linkToParent: () => {
                    fake.links++;
                },
            };
        },
    };

    return fake;
}
