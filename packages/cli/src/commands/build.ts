/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from 'citty';
import type { CommandDef } from 'citty';
import { SOURCE_ENTRY } from '../entry/constants.ts';
import { resolveEntry } from '../entry/module.ts';
import { assertKnownArgs, createUsageError, isRecord } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import {
    BUILD_OUTPUT_PATTERN,
    BUILD_OUT_DIR,
    ENTRY_ARG,
    MODULE_NOT_FOUND_CODE,
    TSDOWN_PACKAGE,
} from './constants.ts';

const BUILD_ARGS = {
    'entry': ENTRY_ARG,
    'out-dir': {
        type: 'string',
        description: `The output folder (default: ${BUILD_OUT_DIR})`,
        valueHint: 'path',
    },
} as const;

type TsdownBuild = (config: Record<string, unknown>) => Promise<unknown>;

/** Whether the error is the import of tsdown itself failing to resolve (not a module tsdown imports). */
function isTsdownMissing(error: unknown): boolean {
    if (!(Error.isError(error))) {
        return false;
    }

    const { code } = error as { code?: unknown };

    return code === MODULE_NOT_FOUND_CODE && error.message.includes(`'${TSDOWN_PACKAGE}'`);
}

async function importTsdown(context: CliContext): Promise<TsdownBuild> {
    let exports: unknown;

    try {
        exports = await context.importModule(TSDOWN_PACKAGE);
    } catch (error) {
        if (isTsdownMissing(error)) {
            throw createUsageError(`chamvi build needs ${TSDOWN_PACKAGE}: npm install --save-dev ${TSDOWN_PACKAGE}`);
        }

        throw error;
    }

    const build = isRecord(exports) ? exports.build : undefined;

    if (typeof build !== 'function') {
        throw createUsageError(`${TSDOWN_PACKAGE} exports no build(): install tsdown ^0.23.1.`);
    }

    return build as TsdownBuild;
}

/** Whether `child` is `parent` or inside it. */
function isWithin(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);

    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Refuses an out dir tsdown's `clean` would wipe more than the build's own
 * output in: the project folder or one above it, a folder holding the entry,
 * and an existing folder holding anything but `.mjs` and `.mjs.map` files.
 */
async function assertOutDir(cwd: string, outDir: string, entry: string): Promise<void> {
    const dir = path.resolve(cwd, outDir);
    const refuse = (reason: string) => createUsageError(`--out-dir ${outDir} ${reason}; chamvi build empties it first, so pick another folder.`);

    if (isWithin(cwd, dir)) {
        throw refuse('is the project folder or above it');
    }

    if (isWithin(entry, dir)) {
        throw refuse('holds the entry');
    }

    let items: Dirent[];

    try {
        items = await readdir(dir, { withFileTypes: true });
    } catch {
        // missing: tsdown creates it
        return;
    }

    const foreign = items.some((item) => !item.isFile() || !BUILD_OUTPUT_PATTERN.test(item.name));

    if (foreign) {
        throw refuse('holds files the build did not write');
    }
}

/**
 * `chamvi build`: bundles the source entry with tsdown into
 * `<out-dir>/index.mjs` (ESM, node24, source map); dependencies and peer
 * dependencies of the app's package.json stay external, the app's own
 * modules are inlined (C2).
 */
export function createBuildCommand(context: CliContext): CommandDef<typeof BUILD_ARGS> {
    return defineCommand({
        meta: {
            name: 'build',
            description: 'Bundle the app into dist/index.mjs (needs tsdown)',
        },
        args: BUILD_ARGS,
        async run({ args }) {
            assertKnownArgs(args, BUILD_ARGS);

            const entry = await resolveEntry({
                cwd: context.cwd,
                entry: args.entry,
                kind: 'source',
            });

            if (entry === undefined) {
                throw createUsageError(`${SOURCE_ENTRY} not found: nothing to build (without an entry, \`chamvi start\` runs the default app) or pass --entry <path>.`);
            }

            const outDir = args['out-dir'] || BUILD_OUT_DIR;

            await assertOutDir(context.cwd, outDir, entry);

            const build = await importTsdown(context);

            await build({
                cwd: context.cwd,
                config: false,
                entry: { index: path.relative(context.cwd, entry) },
                format: 'esm',
                platform: 'node',
                target: 'node24',
                outDir,
                fixedExtension: true,
                sourcemap: true,
                dts: false,
                clean: true,
                logLevel: 'warn',
            });
        },
    });
}
