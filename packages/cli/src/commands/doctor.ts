/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import path from 'node:path';
import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import { loadEntryApp, resolveEntry } from '../entry/module.ts';
import { EXIT_CODE } from '../run/constants.ts';
import { assertKnownArgs, createUsageError } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import { DOTENV_FILE, ENTRY_ARG } from './constants.ts';
import { loadDotEnv, renderReport } from './helpers.ts';

const DOCTOR_ARGS = {
    entry: ENTRY_ARG,
    dev: {
        type: 'boolean',
        description: 'Check the source entry with .env loaded, as chamvi dev runs it',
    },
} as const;

/**
 * `chamvi doctor`: loads the entry and prints `app.inspect()`, the model
 * settings, providers and agents a start would use, without starting
 * anything (no signal handlers, no store). Plain it checks the built entry
 * `start` runs; `--dev` the source entry with `.env` loaded first, like
 * `start --dev`. Exit 0 when the model settings resolve and every agent passes its checks, else 2.
 */
export function createDoctorCommand(context: CliContext): CommandDef<typeof DOCTOR_ARGS> {
    return defineCommand({
        meta: {
            name: 'doctor',
            description: 'Check the model settings, providers and agents a start would use',
        },
        args: DOCTOR_ARGS,
        async run({ args }) {
            assertKnownArgs(args, DOCTOR_ARGS);
            const dev = args.dev === true;
            const { env } = context;

            if (dev) {
                // before the entry import: module factories read env when called
                await loadDotEnv(env, path.join(context.cwd, DOTENV_FILE));
            }

            const entry = await resolveEntry({
                cwd: context.cwd,
                entry: args.entry,
                kind: dev ? 'source' : 'built',
            });
            const app = await loadEntryApp(entry, context);
            if (typeof app.inspect !== 'function') {
                throw createUsageError('The app comes from another @chamvi/app copy without inspect(); install one @chamvi/app version.');
            }

            const report = await app.inspect({ env });
            context.stdout(renderReport(report));
            context.setExitCode(report.ok ? EXIT_CODE.OK : EXIT_CODE.USAGE);
        },
    });
}
