/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { systemClock } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { DEFAULT_LIMITS } from '@chamvi/sandbox';
import type {
    ISandboxProvider,
    IWorkspace,
    WorkspaceCreateOptions,
} from '@chamvi/sandbox';
import { createScriptedWorkspace } from './workspace.ts';
import type { ScriptedWorkspace } from './workspace.ts';

/** The commit every fake checkout reports. */
export const FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

export type FakeProvider = ISandboxProvider & {
    created: WorkspaceCreateOptions[];
    /** Ids of disposed workspaces, in dispose order (each once). */
    disposed: string[];
    gcCalls: number;
    /** Every workspace the provider handed out, by id. */
    workspaces: Map<string, ScriptedWorkspace>;
    failNextCreate(error: Error): void;
    /** Creates wait for this promise (after recording their input) while it is set. */
    gate?: Promise<void>;
    /** The next collectGarbage() rejects with `error`. */
    failNextGc(error: Error): void;
};

/**
 * An in-memory provider: scripted workspaces with uuid ids, `info.commit`
 * set when a repo is given, expiry `limits.maxLifetimeMs` (default
 * DEFAULT_LIMITS.maxLifetimeMs) after the clock's now.
 */
export function createFakeProvider(options: { clock?: IClock } = {}): FakeProvider {
    const clock = options.clock ?? systemClock;
    let nextCreateError: Error | undefined;
    let nextGcError: Error | undefined;
    const provider: FakeProvider = {
        name: 'fake',
        created: [],
        disposed: [],
        gcCalls: 0,
        workspaces: new Map(),
        failNextCreate(error) {
            nextCreateError = error;
        },
        failNextGc(error) {
            nextGcError = error;
        },
        async create(input): Promise<IWorkspace> {
            // a real provider never answers in the same tick
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            provider.created.push(input);
            if (provider.gate) await provider.gate;
            if (nextCreateError) {
                const error = nextCreateError;
                nextCreateError = undefined;
                throw error;
            }
            const now = clock.now();
            const workspace = createScriptedWorkspace(undefined, {
                runId: input.runId,
                provider: 'fake',
                repo: input.repo,
                ref: input.ref,
                commit: input.repo ? FAKE_COMMIT : undefined,
                createdAt: now,
                expiresAt: new Date(now.getTime() + (input.limits?.timeoutMs ?? DEFAULT_LIMITS.maxLifetimeMs)),
            }, randomUUID());
            const dispose = workspace.dispose.bind(workspace);
            workspace.dispose = async () => {
                if (!workspace.disposed) provider.disposed.push(workspace.id);
                await dispose();
            };
            provider.workspaces.set(workspace.id, workspace);
            return workspace;
        },
        async collectGarbage() {
            provider.gcCalls++;
            if (nextGcError) {
                const error = nextGcError;
                nextGcError = undefined;
                throw error;
            }
            return 0;
        },
    };
    return provider;
}
