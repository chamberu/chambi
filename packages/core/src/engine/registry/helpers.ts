/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { ErrorCode, InvalidRunStateError } from '../../errors/index.ts';
import { AGENT_LOCK_TTL_MS, REVISION_PREFIX_LENGTH } from '../constants.ts';
import type { CancelReason, RegistryContext } from './types.ts';

/** What a registry cancel stores on the runs of `agent`. */
export function agentCancelReason(agent: string, kind: 'replaced' | 'removed', revision?: string): CancelReason {
    if (kind === 'removed') {
        return {
            code: ErrorCode.AGENT_REMOVED,
            message: `Agent "${agent}" was removed; its unsettled runs were cancelled.`,
        };
    }
    return {
        code: ErrorCode.AGENT_REPLACED,
        message: revision === undefined ?
            `Agent "${agent}" was replaced; its unsettled runs were cancelled.` :
            `Agent "${agent}" was reloaded at revision ${revision.slice(0, REVISION_PREFIX_LENGTH)}; its unsettled runs were cancelled.`,
    };
}

function delay(ctx: RegistryContext, ms: number): Promise<void> {
    return new Promise((resolve) => {
        ctx.clock.setTimeout(resolve, ms);
    });
}

/**
 * Runs `fn` under the store lock `agents:<name>`, retried every
 * claimTtlMs / 3 on the clock; gives up after AGENT_LOCK_TTL_MS with
 * InvalidRunStateError.
 */
export async function withAgentLock<T>(ctx: RegistryContext, name: string, fn: () => Promise<T>): Promise<T> {
    const key = `agents:${name}`;
    const owner = randomUUID();
    const deadline = ctx.clock.now().getTime() + AGENT_LOCK_TTL_MS;
    while (!await ctx.store.locks.acquire(key, owner, AGENT_LOCK_TTL_MS)) {
        if (ctx.clock.now().getTime() >= deadline) {
            throw new InvalidRunStateError(`The registry lock of agent "${name}" was not released within ${AGENT_LOCK_TTL_MS}ms.`);
        }
        await delay(ctx, ctx.claimTtlMs / 3);
    }
    try {
        return await fn();
    } finally {
        await ctx.store.locks.release(key, owner).catch((error: unknown) => ctx.onError(error));
    }
}
