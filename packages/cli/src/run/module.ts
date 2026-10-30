/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { renderUsage, runCommand } from 'citty';
import type { CommandDef } from 'citty';
import { createMainCommand } from '../commands/module.ts';
import { CITTY_ERROR_NAME, EXIT_CODE } from './constants.ts';
import { exitCodeOf, messageOf, processContext } from './helpers.ts';
import type { CliContext } from './types.ts';

const HELP_FLAGS = ['--help', '-h'];
const VERSION_FLAGS = ['--version', '-v'];

/** The sub command the args name (the first one that is no flag), else undefined. */
async function subCommandOf(main: CommandDef, argv: string[]): Promise<CommandDef | undefined> {
    const name = argv.find((arg) => !arg.startsWith('-'));
    const subCommands = typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;

    if (!name || !subCommands || !Object.prototype.hasOwnProperty.call(subCommands, name)) {
        return undefined;
    }

    const sub = subCommands[name];

    return typeof sub === 'function' ? sub() : sub;
}

/**
 * The command without its hidden args (an arg def carrying `hidden: true`,
 * which citty supports for commands only), for the usage.
 */
async function withoutHiddenArgs(command: CommandDef): Promise<CommandDef> {
    const args = typeof command.args === 'function' ? await command.args() : await command.args;

    if (!args) {
        return command;
    }

    const shown = Object.fromEntries(Object.entries(args).filter(([, arg]) => (arg as { hidden?: unknown }).hidden !== true));

    return { ...command, args: shown };
}

async function usageOf(main: CommandDef, argv: string[]): Promise<string> {
    const sub = await subCommandOf(main, argv);

    return sub ? renderUsage(await withoutHiddenArgs(sub), main) : renderUsage(main);
}

/**
 * Runs `chamvi <argv>`: `--help` and `--version` like citty's runMain, every
 * error to stderr with the exit code of `exitCodeOf` (usage errors with the
 * usage). Sets exit codes through the context, never exits the process.
 */
export async function runCli(argv: string[], context: Partial<CliContext> = {}): Promise<void> {
    const ctx: CliContext = { ...processContext(), ...context };
    const main = createMainCommand(ctx);

    try {
        const requestsHelp = argv.some((arg) => HELP_FLAGS.includes(arg));

        if (requestsHelp) {
            ctx.stdout(`${await usageOf(main, argv)}\n`);

            return;
        }

        if (argv.length === 1 && VERSION_FLAGS.includes(argv[0]!)) {
            const meta = typeof main.meta === 'function' ? await main.meta() : await main.meta;

            ctx.stdout(`${meta?.version ?? 'unknown'}\n`);

            return;
        }

        await runCommand(main, { rawArgs: argv });
    } catch (error) {
        const code = exitCodeOf(error);

        if (Error.isError(error) && error.name === CITTY_ERROR_NAME) {
            ctx.stderr(`${await usageOf(main, argv)}\n\n`);
        }

        const text = code === EXIT_CODE.FAILURE && Error.isError(error) && error.stack ? error.stack : messageOf(error);

        ctx.stderr(`${text}\n`);
        ctx.setExitCode(code);
    }
}
