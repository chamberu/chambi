/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError, SandboxError } from '@chamvi/core';
import {
    CACHE_DIR,
    CACHE_ENV,
    WORKSPACE_HOME,
    abortedCreate,
} from '@chamvi/sandbox';
import type { IWorkspace } from '@chamvi/sandbox';
import { CACHE_OPEN_TIMEOUT_MS } from './constants.ts';

/** `CACHE_DIR` and every folder of `CACHE_ENV` with its parents under it, parents first. */
function cacheFolders(): string[] {
    const folders = new Set<string>([CACHE_DIR]);
    for (const path of Object.values(CACHE_ENV)) {
        const segments = path.slice(CACHE_DIR.length + 1).split('/');
        for (let i = 1; i <= segments.length; i++) {
            folders.add(`${CACHE_DIR}/${segments.slice(0, i).join('/')}`);
        }
    }
    return [...folders];
}

/**
 * Makes `WORKSPACE_HOME`, `CACHE_DIR` and every `CACHE_ENV` folder (made
 * when missing) world writable with the sticky bit, each only when root
 * owns it (another user's folder is left as it is); a failing `chmod`
 * exits 1.
 */
export const CACHE_OPEN_SCRIPT = `for d in ${[WORKSPACE_HOME, ...cacheFolders()].join(' ')}; do ` +
    'mkdir -p "$d" 2>/dev/null; if [ -O "$d" ]; then chmod 1777 "$d" || exit 1; fi; done';

/**
 * Opens the package cache and HOME to a non-root workspace user, through `root` (a
 * workspace over the same container whose commands run as
 * `CACHE_OPEN_USER`, so the PATH guard and the `timeout` wrapper apply):
 * Docker makes the mount point of an image without `/cache` root-owned
 * 0755 (the same for the `WORKSPACE_HOME` volume of an image without that
 * folder; and a root workspace sharing the volume leaves the top-level
 * folders so), where every install of the hardened user would fail. Only
 * those folders: what a root workspace made below them (npm's `_cacache`)
 * stays root's, which is why a non-root user must never share a
 * `cache.volume` a root workspace wrote to (the default `/cache` is an
 * anonymous volume per workspace). SandboxError when
 * it fails, `abortedCreate()` once `signal` fires.
 */
export async function openCache(root: IWorkspace, user: string, signal?: AbortSignal): Promise<void> {
    let result: Awaited<ReturnType<IWorkspace['exec']>>;
    try {
        result = await root.exec(['sh', '-c', CACHE_OPEN_SCRIPT], { timeoutMs: CACHE_OPEN_TIMEOUT_MS, signal });
    } catch (error) {
        if (signal?.aborted) throw abortedCreate(error);
        if (error instanceof ChamviError) throw error;
        throw new SandboxError(`cannot open the package cache ${CACHE_DIR} to user ${user}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (signal?.aborted) throw abortedCreate();
    if (result.exitCode !== 0 || result.timedOut) {
        const reason = result.timedOut ? `no answer within ${CACHE_OPEN_TIMEOUT_MS} ms` : `exit ${result.exitCode}`;
        const detail = result.stderr.trim().slice(0, 500);
        throw new SandboxError(`cannot open the package cache ${CACHE_DIR} to user ${user}: ${reason}${detail ? ` (${detail})` : ''}.`);
    }
}
