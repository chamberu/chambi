/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { AgentRevision } from '../../agent/types.ts';
import { InvalidRunStateError, RunNotFoundError } from '../../errors/index.ts';
import { RunStatus } from '../../run/constants.ts';
import { REVISION_PREFIX_LENGTH } from '../constants.ts';
import { agentCancelReason, withAgentLock } from './helpers.ts';
import type { CancelReason, DropRevisionOptions, RegistryContext } from './types.ts';

const UNSETTLED = [RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.WAITING, RunStatus.INTERRUPTED];

/**
 * Cancels the agent's unsettled runs (created before `before`, when given),
 * concurrently, storing `reason` on each. A run that settled or vanished
 * meanwhile is skipped; any other failure goes to onError and the other runs
 * are still cancelled. Resolves the ids whose cancel went through: a run
 * executing on another replica only gets cancelRequested (it may still
 * complete first) and a local execution being drained settles interrupted,
 * so an id names a requested cancel, not always a cancelled run.
 */
export async function cancelAgentRuns(
    ctx: RegistryContext,
    agent: string,
    reason: CancelReason,
    before?: Date,
): Promise<string[]> {
    const { data } = await ctx.repositories.runs.find({ agent, status: UNSETTLED });
    const runs = before === undefined ?
        data :
        data.filter((run) => run.createdAt.getTime() < before.getTime());
    const results = await Promise.allSettled(runs.map((run) => ctx.cancel(run.id, reason)));
    const cancelled: string[] = [];
    runs.forEach((run, i) => {
        const result = results[i];
        if (result?.status === 'fulfilled') {
            cancelled.push(run.id);
            return;
        }
        if (result?.reason instanceof RunNotFoundError || result?.reason instanceof InvalidRunStateError) return;
        ctx.onError(result?.reason, run);
    });
    return cancelled;
}

/**
 * Brings the stored revision marker of `agent` to `revision`, under the
 * registry lock: when it differs, the runs created before the change are
 * cancelled (only when a marker existed: a first sight cancels nothing) and
 * the marker is written. A marker already at `revision` is left alone, so
 * every change cancels once across replicas. The runs are swept twice: before
 * the write, and again after it with the marker's `changedAt`, since a
 * replica at the old hash may create and start a run until the write lands;
 * from the write on no replica at the old hash starts one. Resolves the
 * cancelled run ids, or undefined when no sweep ran (first sight, unchanged).
 * A marker at `former` (the same content under an earlier hash algorithm) is
 * moved to `revision` without a sweep.
 */
export async function syncRevision(
    ctx: RegistryContext,
    agent: string,
    revision: string,
    former?: string,
): Promise<string[] | undefined> {
    return withAgentLock(ctx, agent, async () => {
        const marker = await ctx.repositories.agentRevisions.findOne(agent);
        if (marker?.hash === revision) return undefined;
        if (await moveFormerMarker(ctx, marker, revision, former)) return undefined;
        const reason = agentCancelReason(agent, 'replaced', revision);
        const cancelled = marker ? await cancelAgentRuns(ctx, agent, reason, ctx.clock.now()) : [];
        const changedAt = ctx.clock.now();
        await ctx.repositories.agentRevisions.save({
            agent,
            hash: revision,
            changedAt,
        });
        if (!marker) return undefined;
        cancelled.push(...await cancelAgentRuns(ctx, agent, reason, changedAt));
        return cancelled;
    });
}

/**
 * Brings the stored revision marker of `agent` to `revision` without ever
 * cancelling (a process that does not reload agents, e.g. a job), under the
 * registry lock: a missing marker is written, an equal one kept, a different one
 * moved only while the agent has no unsettled run; else InvalidRunStateError
 * naming both revisions, marker and runs untouched. A marker at `former`
 * is moved to `revision` like an equal one.
 */
export async function claimRevision(
    ctx: RegistryContext,
    agent: string,
    revision: string,
    former?: string,
): Promise<void> {
    await withAgentLock(ctx, agent, async () => {
        const marker = await ctx.repositories.agentRevisions.findOne(agent);
        if (marker?.hash === revision) return;
        if (await moveFormerMarker(ctx, marker, revision, former)) return;
        if (marker) {
            const { data } = await ctx.repositories.runs.find({
                agent,
                status: UNSETTLED,
                limit: 1,
            });
            if (data.length > 0) {
                const stored = marker.hash.slice(0, REVISION_PREFIX_LENGTH);
                const loaded = revision.slice(0, REVISION_PREFIX_LENGTH);
                throw new InvalidRunStateError(
                    `Agent "${agent}" runs revision ${stored} in the store, not ${loaded}; this process does not reload agents.`,
                );
            }
        }
        await ctx.repositories.agentRevisions.save({
            agent,
            hash: revision,
            changedAt: ctx.clock.now(),
        });
    });
}

/**
 * Removes the agent from the store's view, under the registry lock: with a
 * marker, all its unsettled runs are cancelled and the marker deleted, unless
 * this engine had it at another revision (a newer one was registered
 * elsewhere: both are left alone); without one, its runs are cancelled when
 * it was registered here. Resolves the cancelled run ids, or undefined when
 * no sweep ran.
 */
export async function dropRevision(ctx: RegistryContext, agent: string, options: DropRevisionOptions): Promise<string[] | undefined> {
    return withAgentLock(ctx, agent, async () => {
        const reason = agentCancelReason(agent, 'removed');
        const marker = await ctx.repositories.agentRevisions.findOne(agent);
        if (marker) {
            if (options.revision !== undefined && marker.hash !== options.revision) return undefined;
            const cancelled = await cancelAgentRuns(ctx, agent, reason);
            await ctx.repositories.agentRevisions.delete(agent);
            return cancelled;
        }
        if (options.registered) return cancelAgentRuns(ctx, agent, reason);
        return undefined;
    });
}

/**
 * Moves a marker at `former` (the same content, hashed by an earlier
 * algorithm) to `revision`, keeping its `changedAt`; true when it did.
 */
async function moveFormerMarker(
    ctx: RegistryContext,
    marker: AgentRevision | undefined,
    revision: string,
    former: string | undefined,
): Promise<boolean> {
    if (marker === undefined || former === undefined || marker.hash !== former) return false;
    await ctx.repositories.agentRevisions.save({ ...marker, hash: revision });
    return true;
}
