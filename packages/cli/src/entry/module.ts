/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp, isApp } from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import { createUsageError, isRecord } from '../run/helpers.ts';
import type { CliContext } from '../run/types.ts';
import { BUILT_ENTRY, DEFAULT_APP_NOTICE, SOURCE_ENTRY } from './constants.ts';
import type { ResolveEntryInput } from './types.ts';

async function isFile(file: string): Promise<boolean> {
    try {
        return (await stat(file)).isFile();
    } catch {
        return false;
    }
}

/** `package.json` `chamvi.entry` of `cwd`, undefined without a package.json or the field. */
async function readPackageEntry(cwd: string): Promise<string | undefined> {
    let text: string;

    try {
        text = await readFile(path.join(cwd, 'package.json'), 'utf8');
    } catch {
        return undefined;
    }

    let manifest: unknown;

    try {
        manifest = JSON.parse(text);
    } catch {
        throw createUsageError(`${path.join(cwd, 'package.json')} is not valid JSON.`);
    }

    const chamvi = isRecord(manifest) ? manifest.chamvi : undefined;

    if (!isRecord(chamvi) || typeof chamvi.entry === 'undefined') {
        return undefined;
    }

    if (typeof chamvi.entry !== 'string' || chamvi.entry.length === 0) {
        throw createUsageError('package.json chamvi.entry must be a non-empty path.');
    }

    return chamvi.entry;
}

/**
 * The absolute entry path: `--entry`, else for a source command
 * `package.json` `chamvi.entry`, else `src/index.ts` (source) or
 * `dist/index.mjs` (built; the built commands never read `chamvi.entry`, so
 * an image built from a repo setting it still starts). Undefined when none
 * of the defaults exists: the command runs the default app. A missing
 * `--entry` or `chamvi.entry` file, an `--entry` without a path, and a
 * missing `dist/index.mjs` beside a `src/index.ts` (not built yet) are a
 * `cli_usage` error.
 */
export async function resolveEntry(input: ResolveEntryInput): Promise<string | undefined> {
    if (typeof input.entry !== 'undefined' && (typeof input.entry !== 'string' || input.entry.length === 0)) {
        throw createUsageError('--entry needs a path.');
    }

    if (typeof input.entry === 'string') {
        const file = path.resolve(input.cwd, input.entry);

        if (!(await isFile(file))) {
            throw createUsageError(`${input.entry} not found.`);
        }

        return file;
    }

    if (input.kind === 'built') {
        const file = path.resolve(input.cwd, BUILT_ENTRY);

        if (await isFile(file)) {
            return file;
        }

        if (await isFile(path.resolve(input.cwd, SOURCE_ENTRY))) {
            throw createUsageError(`${BUILT_ENTRY} not found: run \`chamvi build\` or pass --entry ${SOURCE_ENTRY}.`);
        }

        return undefined;
    }

    const configured = await readPackageEntry(input.cwd);

    if (configured) {
        const file = path.resolve(input.cwd, configured);

        if (!(await isFile(file))) {
            throw createUsageError(`${configured} (package.json chamvi.entry) not found.`);
        }

        return file;
    }

    const file = path.resolve(input.cwd, SOURCE_ENTRY);

    return await isFile(file) ? file : undefined;
}

/**
 * Imports the entry (as a file URL) and returns its default export; a default
 * export that is no app is a `cli_usage` error. Errors of the import itself
 * (a module factory missing its env) pass through.
 */
export async function loadApp(file: string, importModule: CliContext['importModule']): Promise<IApp> {
    const exports = await importModule(pathToFileURL(file).href);
    const app = isRecord(exports) ? exports.default : undefined;

    if (!isApp(app)) {
        throw createUsageError(`${file} must \`export default createApp({...})\`.`);
    }

    return app;
}

/**
 * The app of `entry` (see loadApp), or without one the default app
 * `createApp({})`: no code agents, its agents from `./agents` or
 * `CHAMVI_AGENTS_DIR`, configured by env alone; noted on stderr.
 */
export async function loadEntryApp(
    entry: string | undefined,
    context: Pick<CliContext, 'importModule' | 'stderr'>,
): Promise<IApp> {
    if (entry !== undefined) {
        return loadApp(entry, context.importModule);
    }

    context.stderr(DEFAULT_APP_NOTICE);

    return createApp({});
}
