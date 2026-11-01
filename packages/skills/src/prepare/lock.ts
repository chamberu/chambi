/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { isObject } from 'smob';
import { SKILL_PREPARATION_LOCK_STALE_MS } from './constants.ts';
import { locked } from './helpers.ts';

const OWNER_FILE = 'owner.json';
// tells a guard of this process from one an earlier process with the same pid left (a container restart)
const PROCESS_START = Math.round(performance.timeOrigin);

type GuardOwner = {
    host?: unknown;
    pid?: unknown;
    processStart?: unknown;
    token?: unknown;
    createdAt?: unknown;
};

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

async function readOwner(guard: string): Promise<GuardOwner | undefined> {
    try {
        const value: unknown = JSON.parse(await fs.readFile(join(guard, OWNER_FILE), 'utf8'));

        return isObject(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function isStale(owner: GuardOwner | undefined, modifiedAt: number): boolean {
    const createdAt = typeof owner?.createdAt === 'number' ? owner.createdAt : modifiedAt;

    if (Date.now() - createdAt >= SKILL_PREPARATION_LOCK_STALE_MS) {
        return true;
    }

    if (owner?.host !== hostname() || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
        return false;
    }

    if (owner.pid === process.pid) {
        return owner.processStart !== PROCESS_START;
    }

    return !isAlive(owner.pid);
}

/**
 * Removes a stale guard under a second guard (`<guard>.recover`), so two
 * recoverers never remove a guard a third preparer took meanwhile: the owner
 * is read again while it is held. True when the guard is gone (try again).
 */
async function recoverGuard(guard: string): Promise<boolean> {
    const recovery = `${guard}.recover`;

    try {
        await fs.mkdir(recovery);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }

        // a recoverer that died between its mkdir and rmdir
        const stat = await fs.stat(recovery).catch(() => undefined);

        if (stat && Date.now() - stat.mtimeMs >= SKILL_PREPARATION_LOCK_STALE_MS) {
            await fs.rm(recovery, { recursive: true, force: true });
        }

        return false;
    }

    try {
        const stat = await fs.stat(guard).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                return undefined;
            }

            throw error;
        });

        if (!stat) {
            return true;
        }

        if (!isStale(await readOwner(guard), stat.mtimeMs)) {
            return false;
        }

        await fs.rm(guard, { recursive: true, force: true });

        return true;
    } finally {
        await fs.rmdir(recovery).catch(() => {});
    }
}

/**
 * Takes the target's guard (an atomic `mkdir`) and records its owner (host,
 * pid, process start, a token); a stale guard is recovered once, a held one
 * is refused with the lock error naming its path. Resolves the token.
 */
export async function acquireGuard(guard: string): Promise<string> {
    const token = randomUUID();

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await fs.mkdir(guard);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }

            if (attempt === 0 && await recoverGuard(guard)) {
                continue;
            }

            locked(guard);
        }

        try {
            await fs.writeFile(join(guard, OWNER_FILE), JSON.stringify({
                host: hostname(),
                pid: process.pid,
                processStart: PROCESS_START,
                token,
                createdAt: Date.now(),
            }), { flag: 'wx' });
        } catch (error) {
            await fs.rm(guard, { recursive: true, force: true });

            throw error;
        }

        return token;
    }

    return locked(guard);
}

/** Removes the guard unless another preparer recovered and took it meanwhile (its token differs). */
export async function releaseGuard(guard: string, token: string): Promise<void> {
    const owner = await readOwner(guard);

    if (owner?.token !== token) {
        return;
    }

    await fs.rm(join(guard, OWNER_FILE), { force: true });
    await fs.rmdir(guard);
}
