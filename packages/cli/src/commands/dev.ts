/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import { resolveEntry } from '../entry/module.ts';
import { EXIT_CODE } from '../run/constants.ts';
import { assertKnownArgs, messageOf } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import type { ProcessEvent, StopSignal } from '../signals/types.ts';
import { DEV_LINK_VARIABLE, DOTENV_FILE, ENTRY_ARG } from './constants.ts';

const DEV_ARGS = { entry: ENTRY_ARG } as const;

/**
 * `chamvi dev`: `node --watch` over `chamvi start --dev` from the source
 * entry. The child runs detached (its own process group), so a terminal
 * Ctrl-C reaches only this process, which forwards exactly one signal per
 * signal it gets; SIGHUP and this process's exit stop the child with
 * SIGTERM, and the child's stdin is a pipe whose close (this process died,
 * also by SIGKILL) ends the group, so the group never outlives the CLI. The
 * exit code is the child's, 0 when it ended by a forwarded signal, else 1.
 */
export function createDevCommand(context: CliContext): CommandDef<typeof DEV_ARGS> {
    return defineCommand({
        meta: {
            name: 'dev',
            description: 'Run the app from source, restarting on changes (node --watch)',
        },
        args: DEV_ARGS,
        async run({ args }) {
            assertKnownArgs(args, DEV_ARGS);

            const entry = await resolveEntry({
                cwd: context.cwd,
                entry: args.entry,
                kind: 'source',
            });

            // only for an existing file: on Linux, `node --watch` fails on a missing env file (ENOENT)
            const envFile = await access(path.join(context.cwd, DOTENV_FILE)).then(() => true, () => false);
            const child = context.spawn(context.execPath, [
                '--watch',
                ...(envFile ? [`--env-file-if-exists=${DOTENV_FILE}`] : []),
                context.cliPath,
                'start',
                '--dev',
                // without an entry, start runs the default app too
                ...(entry !== undefined ? ['--entry', entry] : []),
            ], {
                cwd: context.cwd,
                env: { ...context.env, [DEV_LINK_VARIABLE]: '1' },
                // stdin: a pipe only this process writes, closed by the OS when it dies (even by SIGKILL)
                stdio: ['pipe', 'inherit', 'inherit'],
                detached: true,
            });

            const forwarded = new Set<string>();
            const listeners = new Map<ProcessEvent, () => void>();
            const forward = (signal: StopSignal) => {
                forwarded.add(signal);
                child.kill(signal);
            };

            listeners.set('SIGINT', () => forward('SIGINT'));
            listeners.set('SIGTERM', () => forward('SIGTERM'));
            listeners.set('SIGHUP', () => forward('SIGTERM'));
            listeners.set('exit', () => forward('SIGTERM'));
            listeners.forEach((fn, event) => context.signals.on(event, fn));

            try {
                const code = await new Promise<number>((resolve, reject) => {
                    child.once('error', reject);
                    child.once('exit', (exitCode: number | null, signal: NodeJS.Signals | null) => {
                        if (typeof exitCode === 'number') {
                            resolve(exitCode);

                            return;
                        }

                        resolve(signal && forwarded.has(signal) ? EXIT_CODE.OK : EXIT_CODE.FAILURE);
                    });
                });

                context.setExitCode(code);
            } catch (error) {
                context.stderr(`chamvi dev: ${messageOf(error)}\n`);
                context.setExitCode(EXIT_CODE.FAILURE);
            } finally {
                listeners.forEach((fn, event) => context.signals.off(event, fn));
                // the open pipe would keep this process alive
                child.stdin?.destroy();
            }
        },
    });
}
