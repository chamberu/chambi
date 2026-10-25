/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import {
    mkdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { InvalidAgentDefinitionError, SandboxError, systemClock } from '@chamvi/core';
import {
    assertCreateInput,
    assertDeployment,
    assertSandboxEnv,
    buildWorkspaceInfo,
    prepareWorkspace,
    readCheckout,
    resolveLimits,
} from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspace, WorkspaceInfo } from '@chamvi/sandbox';
import {
    CACHE_DIR_NAME,
    DEFAULT_ROOT_NAME,
    LOCAL_PROVIDER_NAME,
    REPO_DIR,
    WORKSPACE_RECORD,
} from './constants.ts';
import { collectExpired, listRecords } from './gc.ts';
import { buildEnv, errnoCode, toRecord } from './helpers.ts';
import type { LocalSandboxOptions } from './types.ts';
import { LocalWorkspace } from './workspace.ts';

/**
 * Workspaces in host directories, `<root>/<id>/{workspace.json,home,tmp,repo}`,
 * commands spawned as the host user. **No isolation**: for development and
 * tests, never for untrusted code. Of the limits only `maxLifetimeMs` (the
 * expiry) applies. The package caches point into `<root>/.cache` (`cache`). `find` rebuilds a workspace from its `workspace.json`
 * (run, deployment, repo, ref, env, times; owner-only, as the env may hold
 * tokens), so another provider over the same root (a restarted process)
 * reaches it.
 */
export function createLocalSandbox(options: LocalSandboxOptions = {}): ISandboxProvider {
    if (options.root !== undefined && (typeof options.root !== 'string' || options.root.length === 0)) {
        throw new InvalidAgentDefinitionError('root must be a non-empty path.');
    }
    if (options.cache !== undefined && typeof options.cache !== 'boolean') {
        throw new InvalidAgentDefinitionError('cache must be a boolean.');
    }
    assertSandboxEnv(options.env);
    resolveLimits(options.limits);

    const root = resolve(options.root ?? join(tmpdir(), DEFAULT_ROOT_NAME));
    const cacheDir = options.cache === false ? undefined : join(root, CACHE_DIR_NAME);
    const clock = options.clock ?? systemClock;
    const live = new Map<string, IWorkspace>();

    const open = (id: string, info: WorkspaceInfo, env: Record<string, string> | undefined): IWorkspace => {
        const dir = join(root, id);
        const workspace = new LocalWorkspace({
            id,
            dir,
            info,
            env: buildEnv(dir, { ...options.env, ...env }, cacheDir),
            clock,
            onDispose: () => live.delete(id),
        });
        live.set(id, workspace);
        return workspace;
    };

    return {
        name: LOCAL_PROVIDER_NAME,

        async create(input) {
            assertCreateInput(input);
            const deployment = assertDeployment(input.deployment);
            const limits = resolveLimits(options.limits, input.limits);

            const id = randomUUID();
            const dir = join(root, id);
            const info = buildWorkspaceInfo(input, LOCAL_PROVIDER_NAME, clock.now(), limits.maxLifetimeMs);
            try {
                // the cache folders appear once a tool writes to them
                await mkdir(root, { recursive: true });
                // owner only: the record holds the create's env (tokens)
                await mkdir(dir, { mode: 0o700 });
                for (const sub of [REPO_DIR, 'home', 'tmp']) {
                    await mkdir(join(dir, sub));
                }
                await writeFile(join(dir, WORKSPACE_RECORD), JSON.stringify(toRecord(info, deployment, input.env)), { mode: 0o600 });
            } catch (error) {
                await rm(dir, { recursive: true, force: true }).catch(() => undefined);
                throw new SandboxError(`cannot create the workspace directory (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
            }

            const workspace = open(id, info, input.env);

            try {
                const { commit } = await prepareWorkspace(workspace, {
                    repo: input.repo,
                    ref: input.ref,
                    signal: input.signal,
                });
                if (commit !== undefined) info.commit = commit;
            } catch (error) {
                await workspace.dispose().catch(() => undefined);
                throw error;
            }
            return workspace;
        },

        async find(runId, findOptions = {}) {
            const deployment = assertDeployment(findOptions.deployment);
            const now = clock.now().getTime();
            const found: IWorkspace[] = [];
            for (const { id, record } of await listRecords(root)) {
                if (record.runId !== runId || record.deployment !== deployment || record.info.expiresAt.getTime() <= now) continue;
                const held = live.get(id);
                if (held) {
                    if (!held.disposed) found.push(held);
                    continue;
                }
                // a folder without its repo directory is no workspace any more
                if (!(await stat(join(root, id, REPO_DIR)).catch(() => undefined))?.isDirectory()) continue;
                const workspace = open(id, { ...record.info, provider: LOCAL_PROVIDER_NAME }, record.env);
                const checkout = await readCheckout(workspace, findOptions.signal);
                if (!checkout) {
                    // a create that died before its checkout finished: left to the collection
                    live.delete(id);
                    continue;
                }
                if (checkout.commit !== undefined) workspace.info.commit = checkout.commit;
                found.push(workspace);
            }
            return found;
        },

        collectGarbage: (gcOptions = {}) => collectExpired(root, clock, live, {
            deployment: assertDeployment(gcOptions.deployment),
            isSettled: gcOptions.isSettled,
        }),
    };
}
