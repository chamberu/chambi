/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import {
    basename,
    dirname,
    join,
    resolve,
} from 'node:path';
import { promisify } from 'node:util';
import {
    cleanupTempDir,
    cloneRepo,
    discoverSkills,
    filterSkills,
    installSkillForAgent,
} from 'skills';
import type { PrepareSkillsOptions, PreparedSkill } from './types.ts';
import { copyPreparationOptions, invalid } from './helpers.ts';

const run = promisify(execFile);
const marker = '.chamvi-skills';
const ownership = 'chamvi-skills-v1\n';

async function inspectTarget(directory: string): Promise<boolean> {
    const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return undefined;
        }

        throw error;
    });
    if (!stat) {
        return false;
    }

    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        invalid();
    }

    const entries = await fs.readdir(directory);
    if (entries.length) {
        const file = join(directory, marker);
        const identity = await fs.lstat(file);
        if (!identity.isFile() || identity.size !== ownership.length || await fs.readFile(file, 'utf8') !== ownership) {
            invalid();
        }
    }
    return true;
}

/** Prepare a dedicated corpus during setup/build; the caller owns source selection and content approval. */
export async function prepareSkills(options: PrepareSkillsOptions): Promise<readonly PreparedSkill[]> {
    const {
        revision,
        names,
        requestedDirectory,
        verify,
        signal,
        parsed,
    } = copyPreparationOptions(options);
    signal?.throwIfAborted();

    let clone: string | undefined;
    let stage: string | undefined;
    let lock: string | undefined;
    let previous: string | undefined;
    let result: readonly PreparedSkill[];
    try {
        await fs.mkdir(dirname(requestedDirectory), { recursive: true });
        signal?.throwIfAborted();
        const parent = await fs.realpath(dirname(requestedDirectory));
        signal?.throwIfAborted();
        const directory = join(parent, basename(requestedDirectory));
        const guard = join(parent, `.${basename(directory)}.chamvi-skills-lock`);
        // shortcut: a crashed preparer leaves its guard, remove it manually after confirming no preparer is running.
        await fs.mkdir(guard);
        lock = guard;
        signal?.throwIfAborted();
        await inspectTarget(directory);
        signal?.throwIfAborted();
        stage = await fs.mkdtemp(join(parent, '.chamvi-skills-'));
        signal?.throwIfAborted();
        clone = await cloneRepo(parsed.url, revision);
        // The SDK clone has no signal; join it before cleanup and never copy canceled work.
        signal?.throwIfAborted();
        const { stdout } = await run('git', ['-C', clone, 'rev-parse', '--verify', 'HEAD'], { timeout: 30_000, signal });
        if (stdout.trim().toLowerCase() !== revision) {
            invalid();
        }

        signal?.throwIfAborted();
        // Reject committed links before discovery or copying can follow them.
        const tree = await run('git', ['-C', clone, 'ls-tree', '-r', '-z', 'HEAD'], { timeout: 30_000, signal });
        if (tree.stdout.split('\0').some((entry) => entry.startsWith('120000 '))) {
            invalid();
        }

        signal?.throwIfAborted();
        const discovered = await discoverSkills(clone, parsed.subpath, {
            includeDuplicateNames: true,
            includeInternal: true,
            fullDepth: true,
            // Source diagnostics can contain private YAML excerpts.
            onWarning: () => {},
        });
        signal?.throwIfAborted();
        const selected = filterSkills(discovered, names);
        const staged: PreparedSkill[] = [];
        for (const name of names) {
            signal?.throwIfAborted();
            const matches = selected.filter((skill) => skill.name === name);
            if (matches.length !== 1) {
                invalid();
            }

            const skill = matches[0]!;
            const installed = await installSkillForAgent(skill, 'universal', {
                cwd: stage,
                mode: 'copy',
                global: false,
            });
            signal?.throwIfAborted();
            const path = resolve(installed.path);
            if (!installed.success || path !== join(stage, '.agents', 'skills', name)) {
                invalid();
            }

            if (!(await fs.lstat(path)).isDirectory()) {
                invalid();
            }

            const prepared = Object.freeze({
                name,
                description: skill.description,
                path,
            });
            if (await verify?.(prepared) !== undefined) {
                invalid();
            }

            signal?.throwIfAborted();
            staged.push(prepared);
        }
        const corpus = join(stage, '.agents', 'skills');
        await fs.writeFile(join(corpus, marker), ownership, { flag: 'wx' });
        const exists = await inspectTarget(directory);
        signal?.throwIfAborted();
        // Complete promotion and rollback without cancellation interrupting ownership.
        if (exists) {
            const backup = join(stage, 'previous');
            await fs.rename(directory, backup);
            previous = backup;
        }
        try {
            await fs.rename(corpus, directory);
        } catch (error) {
            if (previous) {
                await fs.rename(previous, directory);
                previous = undefined;
            }
            throw error;
        }
        previous = undefined;
        result = Object.freeze(staged.map((skill) => Object.freeze({ ...skill, path: join(requestedDirectory, skill.name) })));
    } catch (error) {
        if (signal?.aborted && error === signal.reason) {
            throw error;
        }

        if (signal?.aborted && error instanceof Error) {
            if ('code' in error && error.code === 'ABORT_ERR' && error.cause === signal.reason) {
                throw signal.reason;
            }
        }

        return invalid();
    } finally {
        // Keep a backup if restoring the previous corpus itself failed.
        const cleanups = [
            clone && cleanupTempDir(clone),
            stage && !previous && fs.rm(stage, { recursive: true, force: true }),
            lock && fs.rmdir(lock),
        ];
        const settled = await Promise.allSettled(cleanups);
        if (settled.some((result) => result.status === 'rejected')) {
            invalid();
        }
    }

    signal?.throwIfAborted();
    return result;
}
