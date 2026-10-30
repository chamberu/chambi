/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import { loadEntryApp, resolveEntry } from '../entry/module.ts';
import { assertKnownArgs } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import { ENTRY_ARG } from './constants.ts';

const MIGRATE_ARGS = { entry: ENTRY_ARG } as const;

/** `chamvi migrate`: migrates the store (DATABASE_URL required). No signal handlers: Node's default ends it. */
export function createMigrateCommand(context: CliContext): CommandDef<typeof MIGRATE_ARGS> {
    return defineCommand({
        meta: {
            name: 'migrate',
            description: 'Migrate the Postgres store (DATABASE_URL)',
        },
        args: MIGRATE_ARGS,
        async run({ args }) {
            assertKnownArgs(args, MIGRATE_ARGS);

            const entry = await resolveEntry({
                cwd: context.cwd,
                entry: args.entry,
                kind: 'built',
            });
            const app = await loadEntryApp(entry, context);

            await app.migrate({ env: context.env });
        },
    });
}
