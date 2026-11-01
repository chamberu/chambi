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
import {
    copyPreparationOptions,
    invalid,
    toPreparationError,
    unavailable,
} from './helpers.ts';
import { acquireGuard, releaseGuard } from './lock.ts';

const run = promisify(execFile);
const marker = '.chamvi-skills';
const ownership = 'chamvi-skills-v1\n';

async function gitMetadata(args: string[], signal?: AbortSignal) {
    const pending = run('git', args, { timeout: 30_000, signal });
    // Abort rejects before close; cleanup must wait for the actual process and streams.
    const closed = new Promise<void>((done) => {
        pending.child.once('close', () => done());
    });

    try {
        return await pending;
    } catch (error) {
        if (signal?.aborted) {
            throw error;
        }

        const { code, signal: terminatedBy } = error as { code?: unknown; signal?: unknown };

        // a failing or flooding command on the pinned checkout is the source's; a timeout or an external signal is retryable
        if (typeof code === 'number' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            invalid();
        }

        if (typeof terminatedBy === 'string') {
            unavailable();
        }

        throw error;
    } finally {
        await closed;
    }
}

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
        // no ownership marker: the target is not ours
        const identity = await fs.lstat(file).catch(() => invalid());

        if (!identity.isFile() || identity.size !== ownership.length || await fs.readFile(file, 'utf8') !== ownership) {
            invalid();
        }
    }

    return true;
}

/**
 * Prepare a dedicated corpus during setup/build; the caller owns source selection and content approval.
 * Rejects with `InvalidAgentDefinitionError` for configuration (options, pin, source content, authentication,
 * a missing repository, an unowned target), with `SKILL_PREPARATION_LOCKED_ERROR_CODE` while another
 * preparer holds the target's guard, and with `SKILL_PREPARATION_FAILED_ERROR_CODE` for retryable failures.
 */
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
    let lock: { guard: string; token: string } | undefined;
    let previous: string | undefined;
    let result: readonly PreparedSkill[];
    let failed = false;

    try {
        await fs.mkdir(dirname(requestedDirectory), { recursive: true });
        signal?.throwIfAborted();

        const parent = await fs.realpath(dirname(requestedDirectory));

        signal?.throwIfAborted();

        const directory = join(parent, basename(requestedDirectory));
        const guard = join(parent, `.${basename(directory)}.chamvi-skills-lock`);

        // a guard a crashed preparer left is recovered (its process is gone here, or it is older than the bound)
        lock = { guard, token: await acquireGuard(guard) };
        signal?.throwIfAborted();
        await inspectTarget(directory);
        signal?.throwIfAborted();
        stage = await fs.mkdtemp(join(parent, '.chamvi-skills-'));
        signal?.throwIfAborted();
        clone = await cloneRepo(parsed.url, revision);
        // The SDK clone has no signal; join it before cleanup and never copy canceled work.
        signal?.throwIfAborted();

        const { stdout } = await gitMetadata(['-C', clone, 'rev-parse', '--verify', 'HEAD'], signal);

        if (stdout.trim().toLowerCase() !== revision) {
            invalid();
        }

        signal?.throwIfAborted();

        // Reject committed links before discovery or copying can follow them.
        const tree = await gitMetadata(['-C', clone, 'ls-tree', '-r', '-z', 'HEAD'], signal);

        const hasSymlink = tree.stdout.split('\0').some((entry) => entry.startsWith('120000 '));

        if (hasSymlink) {
            invalid();
        }

        signal?.throwIfAborted();

        // discovery reads the pinned checkout only: a failure is the source's, never transient
        const discovered = await discoverSkills(clone, parsed.subpath, {
            includeDuplicateNames: true,
            includeInternal: true,
            fullDepth: true,
            // Source diagnostics can contain private YAML excerpts.
            onWarning: () => {},
        }).catch(() => invalid());

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

            const verdict = await (async () => verify?.(prepared))().catch(() => invalid());

            if (verdict !== undefined) {
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
        failed = true;

        if (signal?.aborted && error === signal.reason) {
            throw error;
        }

        if (signal?.aborted && Error.isError(error)) {
            if ('code' in error && error.code === 'ABORT_ERR' && error.cause === signal.reason) {
                throw signal.reason;
            }
        }

        return toPreparationError(error);
    } finally {
        // Keep a backup if restoring the previous corpus itself failed.
        const cleanups = [
            clone && cleanupTempDir(clone),
            stage && !previous && fs.rm(stage, { recursive: true, force: true }),
            lock && releaseGuard(lock.guard, lock.token),
        ];
        const settled = await Promise.allSettled(cleanups);

        const hasRejectedCleanup = settled.some((result) => result.status === 'rejected');

        // a cleanup failure never replaces the error of a failed preparation (configuration, cancellation)
        if (hasRejectedCleanup && !failed) {
            unavailable();
        }
    }

    signal?.throwIfAborted();

    return result;
}
