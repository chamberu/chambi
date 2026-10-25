/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { InvalidAgentDefinitionError, SandboxError, systemClock } from '@chamvi/core';
import {
    assertCreateInput,
    assertSandboxEnv,
    buildWorkspaceInfo,
    prepareWorkspace,
    resolveLimits,
} from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspace } from '@chamvi/sandbox';
import {
    DEFAULT_ROOT_NAME,
    LOCAL_PROVIDER_NAME,
    REPO_DIR,
    WORKSPACE_RECORD,
} from './constants.ts';
import { collectExpired } from './gc.ts';
import { buildEnv, errnoCode } from './helpers.ts';
import type { LocalSandboxOptions } from './types.ts';
import { LocalWorkspace } from './workspace.ts';

/**
 * Workspaces in host directories, `<root>/<id>/{workspace.json,home,tmp,repo}`,
 * commands spawned as the host user. **No isolation**: for development and
 * tests, never for untrusted code. Of the limits only `timeoutMs` (the
 * expiry) applies.
 */
export function createLocalSandbox(options: LocalSandboxOptions = {}): ISandboxProvider {
    if (options.root !== undefined && (typeof options.root !== 'string' || options.root.length === 0)) {
        throw new InvalidAgentDefinitionError('root must be a non-empty path.');
    }
    assertSandboxEnv(options.env);
    resolveLimits(options.limits);

    const root = resolve(options.root ?? join(tmpdir(), DEFAULT_ROOT_NAME));
    const clock = options.clock ?? systemClock;
    const live = new Map<string, IWorkspace>();

    return {
        name: LOCAL_PROVIDER_NAME,

        async create(input) {
            assertCreateInput(input);
            const limits = resolveLimits(options.limits, input.limits);

            const id = randomUUID();
            const dir = join(root, id);
            const info = buildWorkspaceInfo(input, LOCAL_PROVIDER_NAME, clock.now(), limits.maxLifetimeMs);
            try {
                for (const sub of [REPO_DIR, 'home', 'tmp']) {
                    await mkdir(join(dir, sub), { recursive: true });
                }
                await writeFile(
                    join(dir, WORKSPACE_RECORD),
                    JSON.stringify({ runId: input.runId, expiresAt: info.expiresAt.toISOString() }),
                );
            } catch (error) {
                await rm(dir, { recursive: true, force: true }).catch(() => undefined);
                throw new SandboxError(`cannot create the workspace directory (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
            }

            const workspace = new LocalWorkspace({
                id,
                dir,
                info,
                env: buildEnv(dir, { ...options.env, ...input.env }),
                clock,
                onDispose: () => live.delete(id),
            });
            live.set(id, workspace);

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

        collectGarbage: () => collectExpired(root, clock, live),
    };
}
