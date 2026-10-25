/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IClock } from '@chamvi/core';
import { SandboxError } from '@chamvi/core';
import { collectionError, createSettledCheck } from '@chamvi/sandbox';
import type { GarbageCollectOptions, IWorkspace } from '@chamvi/sandbox';
import { WORKSPACE_ID_PATTERN, WORKSPACE_RECORD } from './constants.ts';
import { errnoCode, parseRecord } from './helpers.ts';
import type { ParsedRecord } from './types.ts';

/** The record of a workspace folder; undefined when it has none or it is unreadable. */
async function readRecord(dir: string): Promise<ParsedRecord | undefined> {
    try {
        return parseRecord(JSON.parse(await readFile(join(dir, WORKSPACE_RECORD), 'utf8')));
    } catch {
        return undefined;
    }
}

/**
 * Every workspace folder under `root` (a uuid name with a readable record),
 * in name order; none without a root directory.
 */
export async function listRecords(root: string): Promise<Array<{ id: string; record: ParsedRecord }>> {
    let names: string[];
    try {
        names = await readdir(root);
    } catch (error) {
        if (errnoCode(error) === 'ENOENT') return [];
        throw new SandboxError(`cannot list the workspaces (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
    }
    const records: Array<{ id: string; record: ParsedRecord }> = [];
    for (const name of names.sort()) {
        if (!WORKSPACE_ID_PATTERN.test(name)) continue;
        const record = await readRecord(join(root, name));
        if (record) records.push({ id: name, record });
    }
    return records;
}

/**
 * Deletes every workspace folder of `deployment` under `root` whose record
 * says it expired (`expiresAt <= now`) or, with `isSettled`, whose run
 * settled. A workspace still open in this process is disposed, so its
 * running commands die too. Folders that are no workspace (no uuid name, no
 * readable record) are left alone. Returns how many were deleted; a folder
 * that cannot go (or whose `isSettled` rejects) never keeps the others (one
 * SandboxError at the end).
 */
export async function collectExpired(
    root: string,
    clock: IClock,
    live: ReadonlyMap<string, IWorkspace>,
    options: { deployment: string; isSettled?: GarbageCollectOptions['isSettled'] },
): Promise<number> {
    const records = await listRecords(root);
    const now = clock.now().getTime();
    let count = 0;
    const failures: SandboxError[] = [];
    const isSettled = createSettledCheck(options.isSettled);
    for (const { id: name, record } of records) {
        if (record.deployment !== options.deployment) continue;
        const dir = join(root, name);
        if (record.info.expiresAt.getTime() > now) {
            const answer = await isSettled(record.runId);
            if (answer instanceof SandboxError) failures.push(answer);
            if (answer !== true) continue;
        }

        const workspace = live.get(name);
        try {
            if (workspace) {
                await workspace.dispose();
            } else {
                await rm(dir, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                });
            }
        } catch (error) {
            failures.push(error instanceof SandboxError ?
                error :
                new SandboxError(`cannot remove workspace ${name} (${errnoCode(error) ?? 'unknown error'}).`, { cause: error }));
            continue;
        }
        count++;
    }
    if (failures.length > 0) throw collectionError(count, failures);
    return count;
}
