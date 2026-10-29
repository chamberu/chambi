/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import {
    basename,
    dirname,
    join,
    resolve,
} from 'node:path';
import { simpleGit } from 'simple-git';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    cleanupTempDir,
    cloneRepo,
    discoverSkills,
    filterSkills,
    installSkillForAgent,
    parseSource,
} from 'skills';
import type { PrepareSkillsOptions, PreparedSkill } from './types.ts';

const marker = '.chamvi-skills';
const ownership = 'chamvi-skills-v1\n';
// eslint-disable-next-line no-control-regex
const controls = /[\x00-\x1f\x7f]/u;

function invalid(): never {
    throw new InvalidAgentDefinitionError('Cannot prepare skills: invalid configuration, source, verification or managed directory.');
}

function readGitMetadata(clone: string, ...args: string[]): Promise<string> {
    const abort = new AbortController();
    return simpleGit({
        abort: abort.signal,
        trimmed: false,
        timeout: {
            block: 30_000,
            stdOut: false,
            stdErr: false,
        },
        completion: { onClose: true, onExit: false },
    }).outputHandler((_command, stdout, stderr) => {
        // Match execFile's former 1 MiB allowance per stream and command.
        for (const stream of [stdout, stderr]) {
            let bytes = 0;
            stream.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 1_048_576) {
                    abort.abort();
                }
            });
        }
    }).raw(['-C', clone, ...args]);
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
        const identity = await fs.lstat(file);
        if (!identity.isFile() || identity.size !== ownership.length || await fs.readFile(file, 'utf8') !== ownership) {
            invalid();
        }
    }
    return true;
}

/** Prepare a dedicated corpus during setup/build; the caller owns source selection and content approval. */
export async function prepareSkills(options: PrepareSkillsOptions): Promise<readonly PreparedSkill[]> {
    if (!options) {
        invalid();
    }

    if (typeof options.source !== 'string' || !options.source.trim() || controls.test(options.source)) {
        invalid();
    }

    if (typeof options.revision !== 'string' || !/^[a-f0-9]{40}$/iu.test(options.revision)) {
        invalid();
    }

    if (!Array.isArray(options.names) || !options.names.length) {
        invalid();
    }

    if (typeof options.directory !== 'string' || !options.directory.trim() || controls.test(options.directory)) {
        invalid();
    }

    if (options.verify !== undefined && typeof options.verify !== 'function') {
        invalid();
    }

    const { source, verify } = options;
    const revision = options.revision.toLowerCase();
    const names = [...options.names];
    for (const name of names) {
        if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(name)) {
            invalid();
        }
    }

    if (new Set(names).size !== names.length) {
        invalid();
    }

    const requestedDirectory = resolve(options.directory);
    if (dirname(requestedDirectory) === requestedDirectory) {
        invalid();
    }

    let clone: string | undefined;
    let stage: string | undefined;
    let lock: string | undefined;
    let previous: string | undefined;
    try {
        const parsed = parseSource(source);
        if (!['local', 'git', 'github', 'gitlab'].includes(parsed.type)) {
            invalid();
        }

        if (parsed.ref || parsed.skillFilter || /^ext::/iu.test(parsed.url)) {
            invalid();
        }

        await fs.mkdir(dirname(requestedDirectory), { recursive: true });
        const parent = await fs.realpath(dirname(requestedDirectory));
        const directory = join(parent, basename(requestedDirectory));
        const guard = join(parent, `.${basename(directory)}.chamvi-skills-lock`);
        // shortcut: a crashed preparer leaves its guard, remove it manually after confirming no preparer is running.
        await fs.mkdir(guard);
        lock = guard;
        await inspectTarget(directory);
        stage = await fs.mkdtemp(join(parent, '.chamvi-skills-'));
        clone = await cloneRepo(parsed.url, revision);
        const stdout = await readGitMetadata(clone, 'rev-parse', '--verify', 'HEAD');
        if (stdout.trim().toLowerCase() !== revision) {
            invalid();
        }

        // Reject committed links before discovery or copying can follow them.
        const tree = await readGitMetadata(clone, 'ls-tree', '-r', '-z', 'HEAD');
        if (tree.split('\0').some((entry) => entry.startsWith('120000 '))) {
            invalid();
        }

        const discovered = await discoverSkills(clone, parsed.subpath, {
            includeDuplicateNames: true,
            includeInternal: true,
            fullDepth: true,
            // Source diagnostics can contain private YAML excerpts.
            onWarning: () => {},
        });
        const selected = filterSkills(discovered, names);
        const staged: PreparedSkill[] = [];
        for (const name of names) {
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

            staged.push(prepared);
        }
        const corpus = join(stage, '.agents', 'skills');
        await fs.writeFile(join(corpus, marker), ownership, { flag: 'wx' });
        if (await inspectTarget(directory)) {
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
        return Object.freeze(staged.map((skill) => Object.freeze({ ...skill, path: join(requestedDirectory, skill.name) })));
    } catch {
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
}
