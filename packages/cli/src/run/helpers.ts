/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawn } from 'node:child_process';
import { ChamviError, systemClock } from '@chamvi/app';
import type { ArgsDef } from 'citty';
import {
    APP_STOPPED_ERROR_CODE,
    CITTY_ERROR_NAME,
    CLI_USAGE_ERROR_CODE,
    EXIT_CODE,
    USAGE_ERROR_CODES,
} from './constants.ts';
import type { CliContext } from './types.ts';

/**
 * A plain object (not an array). Local, since the CLI depends on citty only
 * (C1), so smob's isObject is not available.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createUsageError(message: string): ChamviError {
    return new ChamviError({ code: CLI_USAGE_ERROR_CODE, message });
}

/**
 * The exit code for an error: 2 for usage and configuration errors (citty's
 * CLIError, `cli_usage`, `invalid_agent_definition`), 0 for the app's stop
 * error (the signal handler decides), else 1.
 */
export function exitCodeOf(error: unknown): 0 | 1 | 2 {
    if (!(Error.isError(error))) {
        return EXIT_CODE.FAILURE;
    }

    if (error.name === CITTY_ERROR_NAME) {
        return EXIT_CODE.USAGE;
    }

    const { code } = error as { code?: unknown };

    if (typeof code === 'string' && USAGE_ERROR_CODES.includes(code)) {
        return EXIT_CODE.USAGE;
    }

    if (code === APP_STOPPED_ERROR_CODE) {
        return EXIT_CODE.OK;
    }

    return EXIT_CODE.FAILURE;
}

function camelCase(name: string): string {
    return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function kebabCase(name: string): string {
    return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * citty parses with `strict: false`, so an unknown flag lands in the parsed
 * args; this refuses it, and positionals beyond the defined ones, with a
 * `cli_usage` error.
 */
export function assertKnownArgs(args: Record<string, unknown>, def: ArgsDef): void {
    const known = new Set<string>(['_']);
    let positionals = 0;

    for (const [name, arg] of Object.entries(def)) {
        known.add(name);
        known.add(camelCase(name));
        known.add(kebabCase(name));

        if (arg.type === 'positional') {
            positionals++;

            continue;
        }

        const alias = 'alias' in arg ? arg.alias : undefined;
        const aliases: unknown[] = Array.isArray(alias) ? alias : [alias];

        aliases.forEach((value) => {
            if (typeof value === 'string') {
                known.add(value);
            }
        });
    }

    for (const key of Object.keys(args)) {
        if (!known.has(key)) {
            throw createUsageError(`Unknown option --${key}.`);
        }
    }

    const rest = Array.isArray(args._) ? args._ : [];

    if (rest.length > positionals) {
        throw createUsageError(`Unexpected argument ${String(rest[positionals])}.`);
    }
}

export function messageOf(error: unknown): string {
    return Error.isError(error) ? error.message : String(error);
}

/** The CliContext bound to this process; `cliPath` is the bin (`dist/cli.mjs`), which `chamvi dev` spawns. */
export function processContext(cliPath: string = process.argv[1] ?? ''): CliContext {
    return {
        cwd: process.cwd(),
        env: process.env,
        clock: systemClock,
        signals: {
            on: (event, fn) => process.on(event, fn),
            off: (event, fn) => process.off(event, fn),
        },
        setExitCode: (code) => {
            process.exitCode = code;
        },
        exit: (code) => process.exit(code),
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
        importModule: (specifier) => import(specifier),
        spawn,
        execPath: process.execPath,
        cliPath,
        linkToParent: () => {
            const { stdin } = process;

            stdin.once('end', () => {
                // the watcher (this process's parent) leads the dev group: end the group, else this process alone
                try {
                    process.kill(-process.ppid, 'SIGTERM');
                } catch {
                    process.kill(process.pid, 'SIGTERM');
                }
            });
            stdin.resume();
            // reading stdin must not keep a stopped app alive
            (stdin as { unref?: () => void }).unref?.();
        },
    };
}
