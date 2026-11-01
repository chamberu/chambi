/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { isObject } from 'smob';
import { SKILL_PREPARATION_LOCK_STALE_MS } from './constants.ts';
import { locked } from './helpers.ts';

const OWNER_FILE = 'owner.json';
// a recovery guard only lives for a stat, a read and a remove
const RECOVERY_STALE_MS = 60_000;
// the guards this process holds, shared by every copy of this package in the process (a guard of this
// very process outside it was left by a failed release)
const HELD_KEY = Symbol.for('chamvi.skills.preparationGuards');
const held: Set<string> = ((globalThis as Record<symbol, unknown>)[HELD_KEY] as Set<string> | undefined) ??
    ((globalThis as Record<symbol, unknown>)[HELD_KEY] = new Set<string>()) as Set<string>;
// tells a guard of this process from one an earlier process with the same pid left (a container restart)
const PROCESS_START = Math.round(performance.timeOrigin);

/** A process's start time in clock ticks since boot (Linux `/proc/<pid>/stat`), so a reused pid is told apart. */
function processStartTicks(pid: number | 'self'): string | undefined {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        // the command (field 2) may hold spaces and parentheses: count from its closing parenthesis
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');

        return fields[19];
    } catch {
        return undefined;
    }
}

const PROCESS_TICKS = processStartTicks('self');

type GuardOwner = {
    host?: unknown;
    pid?: unknown;
    processStart?: unknown;
    processTicks?: unknown;
    token?: unknown;
    createdAt?: unknown;
};

/**
 * The age at which any guard is stale: `SKILL_PREPARATION_LOCK_STALE_MS`, or
 * twice the SDK's clone timeout (`SKILLS_CLONE_TIMEOUT_MS`, read like the SDK
 * does) when that is longer, so a live, slow clone keeps its guard.
 */
export function guardStaleMs(env: NodeJS.ProcessEnv = process.env): number {
    const timeout = Number.parseInt(env.SKILLS_CLONE_TIMEOUT_MS ?? '', 10);

    return Number.isFinite(timeout) && timeout > 0 ?
        Math.max(SKILL_PREPARATION_LOCK_STALE_MS, timeout * 2) :
        SKILL_PREPARATION_LOCK_STALE_MS;
}

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

/**
 * A guard of this host is judged by its owner: stale once the owner process is gone (a reused pid
 * is told apart by its start time where `/proc` has it), never by age while that process is known
 * to hold it. Only an owner this host cannot identify (another host on a shared filesystem, a
 * malformed record, no `/proc`) falls back to the age bound.
 */
function isStale(guard: string, owner: GuardOwner | undefined, modifiedAt: number): boolean {
    const createdAt = typeof owner?.createdAt === 'number' ? owner.createdAt : modifiedAt;
    const aged = Date.now() - createdAt >= guardStaleMs();

    if (owner?.host !== hostname() || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
        return aged;
    }

    if (owner.pid === process.pid) {
        return owner.processStart !== PROCESS_START || !held.has(guard);
    }

    if (!isAlive(owner.pid)) {
        return true;
    }

    const ticks = typeof owner.processTicks === 'string' ? owner.processTicks : undefined;
    const current = ticks === undefined ? undefined : processStartTicks(owner.pid);

    if (ticks === undefined || current === undefined) {
        return aged;
    }

    // the pid now belongs to another process: its owner is gone
    return current !== ticks;
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

        if (stat && Date.now() - stat.mtimeMs >= RECOVERY_STALE_MS) {
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

        const owner = await readOwner(guard);

        if (!isStale(guard, owner, stat.mtimeMs)) {
            return false;
        }

        // the owner checked may release and a new preparer take the path before a plain remove:
        // move the guard away atomically, then remove it only when it is still the one checked
        const moved = `${guard}.stale-${randomUUID()}`;

        try {
            await fs.rename(guard, moved);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return true;
            }

            throw error;
        }

        const taken = await readOwner(moved);

        if (taken?.token !== owner?.token) {
            // a live guard taken after the check: put it back (best effort; the window is one rename)
            await fs.rename(moved, guard).catch(() => {});

            return false;
        }

        await fs.rm(moved, { recursive: true, force: true });

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
                ...(PROCESS_TICKS !== undefined ? { processTicks: PROCESS_TICKS } : {}),
                token,
                createdAt: Date.now(),
            }), { flag: 'wx' });
        } catch (error) {
            await fs.rm(guard, { recursive: true, force: true });

            throw error;
        }

        held.add(guard);

        return token;
    }

    return locked(guard);
}

/** Removes the guard unless another preparer recovered and took it meanwhile (its token differs). */
export async function releaseGuard(guard: string, token: string): Promise<void> {
    try {
        const owner = await readOwner(guard);

        if (owner?.token !== token) {
            return;
        }

        await fs.rm(join(guard, OWNER_FILE), { force: true });
        await fs.rmdir(guard);
    } finally {
        // a guard this release failed to remove is stale for this process's next attempt
        held.delete(guard);
    }
}
