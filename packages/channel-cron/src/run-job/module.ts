/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Run } from '@chamvi/core';
import { fireCronSubscription } from '../tick/index.ts';
import { SETTLING } from './constants.ts';
import { isQueuedBehindApproval, resolveCronSubscription } from './helpers.ts';
import type { RunJobOptions, RunJobResult } from './types.ts';

/**
 * Fires one cron subscription once (for a Kubernetes CronJob): dispatches the
 * tick at the engine clock's `now()` (the overlap policy applies), then starts
 * the engine without its channels (no schedules, sockets or polling) and
 * runs one approval tick, so leftovers of earlier jobs (a run whose pod was
 * killed, an interrupted run, an answered or expired approval) are recovered
 * and executed even when the tick is skipped. It waits for the dispatched run
 * to complete, fail, be cancelled, wait for an approval, or stay queued behind
 * a run of its concurrency key that waits for an approval, then drains the
 * engine. An aborted `signal` ends the wait (or, aborted before the call,
 * fires nothing). Never calls process.exit; set `process.exitCode` from `exitCode`.
 *
 * Caveats: `engine.start()` recovers and executes **every** queued run of
 * **every** agent in the shared store, not only the cron run, and the final
 * `drain()` interrupts whatever is still running after `drainTimeoutMs`, for a
 * long-lived replica (or the next job pod) to resume. Size `drainTimeoutMs` to
 * the job's runs, and prefer a long-lived deployment with cronChannel() when
 * runs are long.
 */
export async function runJob(opts: RunJobOptions): Promise<RunJobResult> {
    const {
        engine,
        agent,
        pollMs = 1_000,
        drainTimeoutMs = 30_000,
        signal,
    } = opts;
    const { clock, stores: store } = engine;
    const subscription = resolveCronSubscription(engine, agent, opts.subscription);
    // a stop that arrived before the job must not recover and execute the store's queued runs
    if (signal?.aborted) return { status: 'skipped', exitCode: 0 };

    const tick = await fireCronSubscription({
        engine,
        agent,
        subscription,
        scheduledAt: clock.now(),
    });

    let timer: { clear(): void } | undefined;
    let unsubscribe: (() => void) | undefined;
    let onAbort: (() => void) | undefined;
    let settled = false;
    let run: Run | undefined;
    try {
        // recovery, the queue and the approval tick also run when the tick was skipped
        // checked again after start: a stop that arrived meanwhile must not deny approvals or notify
        // a one-shot job never starts channels (cron schedules, sockets)
        if (!signal?.aborted) await engine.start({ channels: false });
        if (!signal?.aborted) await engine.tick();
        if (tick.dispatched && !signal?.aborted) {
            const { runId } = tick;
            run = await new Promise<Run | undefined>((resolve, reject) => {
                const done = (candidate: Run | undefined) => {
                    settled = true;
                    resolve(candidate);
                };
                // a signal is a request to stop, not an error: the wait ends and the drain runs
                onAbort = () => done(undefined);
                signal?.addEventListener('abort', onAbort, { once: true });
                // the event only shortens the wait; the poll covers a run executed elsewhere
                unsubscribe = engine.on('run.updated', (e) => {
                    if (e.type === 'run.updated' && e.run.id === runId && SETTLING.includes(e.run.status)) done(e.run);
                });
                const poll = async () => {
                    if (settled) return;
                    const candidate = await engine.getRun(runId);
                    if (settled) return;
                    if (candidate && (SETTLING.includes(candidate.status) || await isQueuedBehindApproval(store.runs, candidate))) {
                        done(candidate);
                        return;
                    }
                    // a poll in flight when the run settled must not re-arm the timer
                    if (!settled) timer = clock.setTimeout(() => poll().catch(reject), pollMs, { keepAlive: true });
                };
                poll().catch(reject);
            });
        }
    } catch (error) {
        // the engine was started: shut it down before reporting
        settled = true;
        await engine.drain({ timeoutMs: drainTimeoutMs }).catch(() => {});
        throw error;
    } finally {
        settled = true;
        timer?.clear();
        unsubscribe?.();
        if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
    await engine.drain({ timeoutMs: drainTimeoutMs });

    // aborted: the run as the drain left it (interrupted, or running when the drain timed out)
    if (!run && tick.dispatched) run = await engine.getRun(tick.runId);
    if (!run) return { status: 'skipped', exitCode: 0 };
    return {
        runId: run.id,
        status: run.status,
        exitCode: run.status === 'failed' || run.status === 'cancelled' ? 1 : 0,
    };
}
