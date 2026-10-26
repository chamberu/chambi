/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFile } from 'node:child_process';
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
    dirname,
    isAbsolute,
    join,
    normalize,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ValidationError } from '@chamvi/core';
import type { GitFixture } from './types.ts';

const run = promisify(execFile);

/**
 * A temporary git repository with one commit of `files` (paths relative to
 * the repository, directories created) on branch `main`, tagged `v1`. The
 * user's and the system's git config are ignored, so signing or hooks
 * configured on the machine never get in the way; `git()` runs more git
 * commands in it the same way.
 */
export async function createGitFixture(files: Record<string, string>): Promise<GitFixture> {
    for (const name of Object.keys(files)) {
        const normalized = normalize(name);
        if (name === '' || isAbsolute(name) || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
            throw new ValidationError(`fixture file ${JSON.stringify(name)} must be a path inside the repository.`);
        }
    }
    const path = await mkdtemp(join(tmpdir(), 'chamvi-git-fixture-'));
    const env = {
        PATH: process.env.PATH ?? '',
        HOME: path,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'chamvi',
        GIT_AUTHOR_EMAIL: 'fixture@chamvi.dev',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_NAME: 'chamvi',
        GIT_COMMITTER_EMAIL: 'fixture@chamvi.dev',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
        // one count per key: commits and tags are never signed
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'commit.gpgsign',
        GIT_CONFIG_VALUE_0: 'false',
        GIT_CONFIG_KEY_1: 'tag.gpgsign',
        GIT_CONFIG_VALUE_1: 'false',
    };
    const git = async (...args: string[]) => {
        const { stdout } = await run('git', args, { cwd: path, env });
        return stdout;
    };

    try {
        for (const [name, content] of Object.entries(files)) {
            const file = join(path, name);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, content);
        }
        await git('-c', 'init.defaultBranch=main', 'init', '-q', '.');
        await git('add', '--all');
        await git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'fixture');
        await git('-c', 'tag.gpgsign=false', 'tag', 'v1');
        const commit = (await git('rev-parse', 'HEAD')).trim();

        return {
            path,
            url: pathToFileURL(path).href,
            commit,
            git,
            cleanup: () => rm(path, { recursive: true, force: true }),
        };
    } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
    }
}
