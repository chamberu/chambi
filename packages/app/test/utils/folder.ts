/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A fresh temp folder; `remove()` deletes it. */
export async function createTempDir(): Promise<{ path: string; remove: () => Promise<void> }> {
    const path = await mkdtemp(join(tmpdir(), 'chamvi-loader-'));

    return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

/** Writes each `relative path -> content` below `root`, creating folders as needed. */
export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
        const target = join(root, path);

        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
    }
}
