/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { TIMER_MAX_MS, envInteger } from '@chamvi/app';
import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import { loadEntryApp, resolveEntry } from '../entry/module.ts';
import { EXIT_CODE } from '../run/constants.ts';
import { assertKnownArgs, exitCodeOf } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import { installSignalHandlers } from '../signals/module.ts';
import {
    ENTRY_ARG,
    FORCE_EXIT_MS,
    FORCE_EXIT_VARIABLE,
} from './constants.ts';

const RUN_JOB_ARGS = {
    agent: {
        type: 'positional',
        description: 'The agent whose cron subscription fires',
        required: true,
    },
    subscriptionId: {
        type: 'positional',
        description: 'The cron subscription id (default: the agent\'s only cron subscription)',
        required: false,
    },
    entry: ENTRY_ARG,
} as const;

/**
 * `chamvi run-job <agent> [subscriptionId]`: fires one cron subscription once and waits
 * for its run; exit 0 for completed, waiting, skipped, queued behind an
 * approval or interrupted by a signal, 1 for failed or cancelled (also when
 * a signal arrived meanwhile) or a failed stop.
 */
export function createRunJobCommand(context: CliContext): CommandDef<typeof RUN_JOB_ARGS> {
    return defineCommand({
        meta: {
            name: 'run-job',
            description: 'Fire one cron subscription once and wait for its run (Kubernetes CronJob)',
        },
        args: RUN_JOB_ARGS,
        async run({ args }) {
            assertKnownArgs(args, RUN_JOB_ARGS);

            const { env } = context;
            const forceExitMs = envInteger(env, FORCE_EXIT_VARIABLE, { default: FORCE_EXIT_MS, max: TIMER_MAX_MS });
            const entry = await resolveEntry({
                cwd: context.cwd,
                entry: args.entry,
                kind: 'built',
            });
            const app = await loadEntryApp(entry, context);

            // the job's own exit code; a signal's stop never lowers it (a failed run stays 1)
            let jobCode: number = EXIT_CODE.OK;
            const handlers = installSignalHandlers({
                target: context.signals,
                clock: context.clock,
                forceExitMs,
                stop: () => app.stop(),
                setExitCode: (code) => context.setExitCode(Math.max(code, jobCode)),
                exit: context.exit,
                stderr: context.stderr,
            });

            let result;

            try {
                result = await app.runJob({
                    agent: args.agent,
                    ...(typeof args.subscriptionId === 'string' && { subscription: args.subscriptionId }),
                    env,
                });
            } catch (error) {
                if (!handlers.signalled) {
                    handlers.dispose();
                } else if (exitCodeOf(error) === EXIT_CODE.OK) {
                    // stopped before the job ran: the handler sets the exit code
                    return;
                } else {
                    jobCode = exitCodeOf(error);
                }

                throw error;
            }

            if (!handlers.signalled) {
                handlers.dispose();
            }

            jobCode = result.exitCode;

            const run = result.runId ? ` (run ${result.runId})` : '';

            context.stdout(`${args.agent}: ${result.status}${run}\n`);

            if (!handlers.signalled || result.exitCode !== EXIT_CODE.OK) {
                context.setExitCode(result.exitCode);
            }
        },
    });
}
