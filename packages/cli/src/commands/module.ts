/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import type { CliContext } from '../run/types.ts';
import { createBuildCommand } from './build.ts';
import { createDevCommand } from './dev.ts';
import { createDoctorCommand } from './doctor.ts';
import { readVersion } from './helpers.ts';
import { createMigrateCommand } from './migrate.ts';
import { createRunJobCommand } from './run-job.ts';
import { createStartCommand } from './start.ts';

/**
 * The `chamvi` command. Built over the context, since citty hands a
 * sub command no `data`.
 */
export function createMainCommand(context: CliContext): CommandDef {
    return defineCommand({
        meta: {
            name: 'chamvi',
            version: readVersion(),
            description: 'Run a chamvi app: dev, build, start, run-job, migrate, doctor',
        },
        subCommands: {
            dev: createDevCommand(context),
            build: createBuildCommand(context),
            start: createStartCommand(context),
            'run-job': createRunJobCommand(context),
            migrate: createMigrateCommand(context),
            doctor: createDoctorCommand(context),
        },
    });
}
