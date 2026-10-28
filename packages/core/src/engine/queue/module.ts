/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RunStatus } from '../../run/constants.ts';
import type { Run } from '../../run/types.ts';
import { admitRun } from './admission.ts';
import { groupKey } from './helpers.ts';
import type { RunQueueOptions } from './types.ts';

/**
 * Concurrency-aware scheduler: starts queued runs in FIFO order of createdAt
 * when (a) a local slot is free, (b) no run of the same agent + concurrencyKey
 * is running, waiting or interrupted (checked in the store, as replicas share it) and
 * (c) the run claim succeeds; runs the `prepareStart` predicate refuses are
 * skipped and stay queued.
 */
export class RunQueue {
    protected readonly opts: RunQueueOptions;

    /** run id to the group key (only keyed runs) of runs executing in this process. */
    protected running = new Map<string, string | undefined>();

    protected inflight = new Set<Promise<void>>();

    protected pumping: Promise<void> | undefined;

    protected again = false;

    protected pollGeneration = 0;

    protected poll: { clear(): void } | undefined;

    protected halted = false;

    constructor(opts: RunQueueOptions) {
        this.opts = opts;
    }

    /**
     * Every claimTtlMs/3: run onPoll, then re-run scheduling, so runs unblocked
     * elsewhere (other replicas) get picked up. idle() waits for a poll in progress.
     */
    startPolling(): void {
        if (this.poll) return;
        const generation = ++this.pollGeneration;
        const tick = () => {
            this.poll = this.opts.clock.setTimeout(() => {
                const work: Promise<void> = Promise.resolve()
                    .then(() => this.opts.onPoll?.())
                    .catch((error: unknown) => this.opts.onError(error))
                    .then(() => this.pump())
                    .finally(() => {
                        this.inflight.delete(work);
                        // a stop() (and possibly a new start()) happened meanwhile: this chain is dead
                        if (generation === this.pollGeneration) tick();
                    });
                this.inflight.add(work);
            }, Math.max(1, Math.floor(this.opts.claimTtlMs / 3)));
        };
        tick();
    }

    stopPolling(): void {
        this.pollGeneration++;
        this.poll?.clear();
        this.poll = undefined;
    }

    /**
     * Stops polling and starting runs (passes become no-ops) until resume().
     * Resolves once a pass in progress finished, so no run starts afterwards.
     */
    async halt(): Promise<void> {
        this.halted = true;
        this.stopPolling();
        await this.pumping;
    }

    resume(): void {
        this.halted = false;
    }

    /** Request a scheduling pass; coalesces overlapping requests. */
    pump(): Promise<void> {
        if (this.pumping) {
            this.again = true;
            return this.pumping;
        }
        this.pumping = (async () => {
            try {
                do {
                    this.again = false;

                    await this.pass();
                } while (this.again);
            } catch (error) {
                this.opts.onError(error);
            } finally {
                this.pumping = undefined;
            }
        })();
        return this.pumping;
    }

    /** Resolves when nothing is running and nothing more can be started. */
    async idle(): Promise<void> {
        while (this.pumping || this.inflight.size > 0) {
            await Promise.all([this.pumping, ...this.inflight]);
        }
    }

    protected async pass(): Promise<void> {
        if (this.halted || this.running.size >= this.opts.maxConcurrentRuns) return;
        const { store } = this.opts;
        const { data: queued } = await store.listRuns({ status: [RunStatus.QUEUED] });
        if (queued.length === 0) return;
        const mayStart = await this.opts.prepareStart?.();
        for (const run of queued) {
            if (this.halted || this.running.size >= this.opts.maxConcurrentRuns) return;
            if (mayStart && !mayStart(run)) continue;

            const started = await admitRun(this.opts, run, (candidate) => this.tryStart(candidate), mayStart);
            if (started) this.launch(started);
        }
    }

    protected async tryStart(run: Run): Promise<Run | undefined> {
        const {
            store,
            owner,
            claimTtlMs,
        } = this.opts;
        if (run.concurrencyKey === undefined) return this.transition(run, undefined);

        // keyed runs: check + claim + mark running must be atomic across replicas.
        // The lock TTL is claimTtlMs: a transition slower than that lets a second replica in.
        const lockKey = `concurrency:${run.agent}:${run.concurrencyKey}`;
        if (!await store.acquire(lockKey, owner, claimTtlMs)) return undefined;
        try {
            return await this.transition(run, groupKey(run));
        } finally {
            await store.release(lockKey, owner).catch((error: unknown) => {
                try {
                    this.opts.onError(error, run);
                } catch {
                    // A throwing reporter must not prevent launch after the running transition.
                }
            });
        }
    }

    protected async transition(run: Run, group: string | undefined): Promise<Run | undefined> {
        const {
            store,
            clock,
            owner,
            claimTtlMs,
        } = this.opts;
        // still finishing its previous execution here: the pump after it ends starts it
        if (this.running.has(run.id)) return undefined;
        if (group !== undefined) {
            if (this.running.values().toArray().includes(group)) return undefined;
            const { total } = await store.listRuns({
                agent: run.agent,
                // an interrupted run is unfinished and keeps its key until recovery requeues it
                status: [RunStatus.RUNNING, RunStatus.WAITING, RunStatus.INTERRUPTED],
                concurrencyKey: run.concurrencyKey,
                limit: 1,
            });
            if (total > 0) return undefined;
        }
        if (!await store.claimRun(run.id, owner, claimTtlMs)) return undefined;
        // reserve the slot before the next await so concurrent passes cannot overshoot
        this.running.set(run.id, group);
        try {
            const now = clock.now();
            return await store.updateRun(run.id, {
                status: RunStatus.RUNNING,
                startedAt: now,
                updatedAt: now,
            }, { expectStatus: [RunStatus.QUEUED], expectOwner: owner });
        } catch (error) {
            this.running.delete(run.id);
            this.opts.onError(error, run);
            return undefined;
        }
    }

    protected launch(run: Run): void {
        this.opts.onRunUpdated(run);
        const renewal = this.keepClaim(run.id);
        const task: Promise<void> = this.opts.execute(run)
            .catch((error: unknown) => this.opts.onError(error, run))
            .finally(() => {
                renewal.stop();
                this.running.delete(run.id);
            })
            .then(() => this.pump())
            .finally(() => {
                this.inflight.delete(task);
            });
        this.inflight.add(task);
    }

    protected keepClaim(runId: string): { stop(): void } {
        const {
            store,
            clock,
            owner,
            claimTtlMs,
        } = this.opts;
        let stopped = false;
        let timer: { clear(): void } | undefined;
        const schedule = () => {
            timer = clock.setTimeout(() => {
                store.renewClaim(runId, owner, claimTtlMs).then(
                    (ok) => {
                        if (stopped) return;
                        if (ok) schedule();
                        else this.opts.onLeaseLost?.(runId);
                    },
                    // a failed call proves nothing: retry while the lease may still be ours
                    () => {
                        if (!stopped) schedule();
                    },
                );
            }, Math.max(1, Math.floor(claimTtlMs / 3)));
        };
        schedule();
        return {
            stop: () => {
                stopped = true;
                timer?.clear();
            },
        };
    }
}
