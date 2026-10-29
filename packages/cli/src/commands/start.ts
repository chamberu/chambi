/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import * as nodeModule from 'node:module';
import path from 'node:path';
import { TIMER_MAX_MS, envInteger } from '@chamvi/app';
import type { AppCheckResult } from '@chamvi/app';
import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import { loadEntryApp, resolveEntry } from '../entry/module.ts';
import { EXIT_CODE } from '../run/constants.ts';
import { assertKnownArgs, createUsageError } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import { installSignalHandlers } from '../signals/module.ts';
import type { SignalHandlers } from '../signals/types.ts';
import {
    CHECK_PASSED_MESSAGE,
    DEV_FORCE_EXIT_MS,
    DEV_LINK_VARIABLE,
    DOTENV_FILE,
    ENTRY_ARG,
    FORCE_EXIT_MS,
    FORCE_EXIT_VARIABLE,
} from './constants.ts';
import { loadDotEnv } from './helpers.ts';

const START_ARGS = {
    entry: ENTRY_ARG,
    dev: {
        type: 'boolean',
        description: 'Development mode (used by chamvi dev)',
        // left out of the usage (C3)
        hidden: true,
    },
    check: {
        type: 'boolean',
        description: 'Check the configuration, store and agents a start would use, then exit (0 ok, 1 runtime failure, 2 configuration or agent issues)',
    },
} as const;

/**
 * `chamvi start`: loads the entry, installs the signal handlers, then
 * `app.start()`. `--dev` reads `.env`, defaults to the source entry and
 * passes `dev` to the app (memory repositories, random secret and token).
 * `--check` runs `app.check()` instead: the same start path up to its start
 * steps, writing nothing to the store; the agent folders' issues go to
 * stderr one per line (exit 2), a clean check prints CHECK_PASSED_MESSAGE.
 */
export function createStartCommand(context: CliContext): CommandDef<typeof START_ARGS> {
    return defineCommand({
        meta: {
            name: 'start',
            description: 'Start the app: HTTP, engine and channels',
        },
        args: START_ARGS,
        async run({ args }) {
            assertKnownArgs(args, START_ARGS);
            const dev = args.dev === true;
            const check = args.check === true;
            const { env } = context;

            if (dev) {
                // before the entry import: module factories read env when called
                await loadDotEnv(env, path.join(context.cwd, DOTENV_FILE));
            }
            const forceExitMs = envInteger(env, FORCE_EXIT_VARIABLE, {
                default: dev ? DEV_FORCE_EXIT_MS : FORCE_EXIT_MS,
                max: TIMER_MAX_MS,
            });

            (nodeModule as { setSourceMapsSupport?: (enabled: boolean) => void }).setSourceMapsSupport?.(true);
            const entry = await resolveEntry({
                cwd: context.cwd,
                entry: args.entry,
                kind: dev ? 'source' : 'built',
            });
            const app = await loadEntryApp(entry, context);
            if (check && typeof app.check !== 'function') {
                throw createUsageError('The app comes from another @chamvi/app copy without check(); install one @chamvi/app version.');
            }

            const handlers = installSignalHandlers({
                target: context.signals,
                clock: context.clock,
                forceExitMs,
                stop: () => app.stop(),
                setExitCode: context.setExitCode,
                exit: context.exit,
                stderr: context.stderr,
            });
            if (check) {
                await runCheck(context, app.check({ dev, env }), handlers);
                return;
            }
            if (dev && env[DEV_LINK_VARIABLE] === '1') {
                context.linkToParent();
            }

            try {
                await app.start({ dev, env });
            } catch (error) {
                if (handlers.signalled) {
                    // stopped mid-setup: the handler sets the exit code
                    return;
                }
                handlers.dispose();
                throw error;
            }
        },
    });
}

/** Prints a check's outcome: the passed line, or each issue on stderr and exit 2. */
async function runCheck(
    context: CliContext,
    checked: Promise<AppCheckResult>,
    handlers: SignalHandlers,
): Promise<void> {
    try {
        const { issues } = await checked;
        if (issues.length === 0) {
            context.stdout(`${CHECK_PASSED_MESSAGE}\n`);
        } else {
            for (const issue of issues) context.stderr(`${issue.message}\n`);
            context.setExitCode(EXIT_CODE.USAGE);
        }
    } catch (error) {
        // stopped mid-check: the handler sets the exit code
        if (handlers.signalled) return;
        throw error;
    } finally {
        if (!handlers.signalled) handlers.dispose();
    }
}
