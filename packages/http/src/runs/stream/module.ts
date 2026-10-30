/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Run,
    RunDelta,
    RunEvent,
    Step,
} from '@chamvi/core';
import { createEventStream } from 'routup';
import type { IAppEvent } from 'routup';
import { acquireStreamSlot, refuseStreamOverCap, refuseWhenClosed } from '../../app/helpers.ts';
import type { HttpContext } from '../../app/types.ts';
import { serializeRun, serializeStep } from '../helpers.ts';
import {
    isNewer,
    isSettled,
    parseAfter,
    resolveLastStep,
    usageChanged,
} from './helpers.ts';

/**
 * Streams a run as SSE: `run.updated` with the current run, then each step
 * after `Last-Event-ID` (or the `after` query, for clients that cannot set
 * the header; a valid header wins) as `step.appended` (`id` = step index), then live
 * events (the model output of an execution on this replica as `delta`,
 * without `id`), with a store poll every `streamPollMs` for runs executing on
 * another replica (`ping` when it found nothing; the steps are read only
 * when the polled run changed). Ends once a settled run
 * was sent, on shutdown, when the client goes away (a failed write or the
 * request signal) or when the poll fails (reported to `onError`). A failing
 * snapshot is an error response (500, or 404 for a run gone meanwhile), not
 * an empty stream; after shutdown ran the closers it is 503, and with all
 * `stream.maxOpen` slots taken a 503 with `Retry-After`. The stream holds
 * one slot until it ends. The caller checks the run exists and may be read.
 */
export async function streamRun(event: IAppEvent, ctx: HttpContext, runId: string): Promise<Response> {
    const after = parseAfter(event.searchParams);
    const refused = refuseWhenClosed(event, ctx);
    if (refused) return refused;
    const slot = acquireStreamSlot(ctx);
    if (!slot) return refuseStreamOverCap(event);
    const release: () => void = slot;

    const stream = createEventStream(event);
    let lastStep = resolveLastStep(event.request.headers.get('last-event-id'), after);
    let lastRun: Run | undefined;
    let ended = false;
    let ready = false;
    let timer: { clear(): void } | undefined;
    const buffered: RunEvent[] = [];

    const unsubscribeRun = ctx.engine.on('run.updated', (e) => {
        if (e.run.id === runId) live(e);
    });
    const unsubscribeStep = ctx.engine.on('step.appended', (e) => {
        if (e.step.runId === runId) live(e);
    });
    const unsubscribeDelta = ctx.engine.on('run.delta', (e) => {
        if (e.delta.runId === runId) live(e);
    });
    const { signal } = event.request;

    function cleanup(): void {
        if (ended) return;
        ended = true;
        unsubscribeRun();
        unsubscribeStep();
        unsubscribeDelta();
        timer?.clear();
        signal.removeEventListener('abort', cleanup);
        ctx.closers.delete(cleanup);
        stream.end();
        release();
    }

    function write(message: {
        event: string;
        id?: string;
        data: string
    }): boolean {
        if (ended) return false;
        if (stream.write(message)) return true;
        // the client went away
        cleanup();
        return false;
    }

    function sendRun(run: Run): boolean {
        lastRun = run;
        return write({ event: 'run.updated', data: JSON.stringify(serializeRun(run)) });
    }

    function sendStep(step: Step): boolean {
        if (step.index <= lastStep) return false;
        lastStep = step.index;
        return write({
            event: 'step.appended',
            id: String(step.index),
            data: JSON.stringify(serializeStep(step)),
        });
    }

    /** Live model output; no `id`, so `Last-Event-ID` stays a step index. */
    function sendDelta(delta: RunDelta): void {
        write({
            event: 'delta',
            data: JSON.stringify({
                step: delta.step,
                kind: delta.kind,
                text: delta.text,
            }),
        });
    }

    function sendSteps(steps: Step[]): boolean {
        let sent = false;
        for (const step of [...steps].sort((a, b) => a.index - b.index)) {
            if (sendStep(step)) sent = true;
        }
        return sent;
    }

    function fail(error: unknown): void {
        if (ended) return;
        ctx.onError(error);
        cleanup();
    }

    /** Sends the steps not sent yet, then ends: the settled run was the last word. */
    async function settle(): Promise<void> {
        try {
            const steps = await ctx.store.steps.find(runId);
            sendSteps(steps);
            cleanup();
        } catch (error) {
            fail(error);
        }
    }

    function live(e: RunEvent): void {
        if (ended) return;
        if (!ready) {
            buffered.push(e);
            return;
        }
        if (e.type === 'step.appended') {
            sendStep(e.step);
            return;
        }
        if (e.type === 'run.delta') {
            sendDelta(e.delta);
            return;
        }
        if (e.type !== 'run.updated') return;
        sendRun(e.run);
        if (isSettled(e.run)) void settle();
    }

    function arm(): void {
        if (ended) return;
        timer = ctx.clock.setTimeout(() => {
            void poll();
        }, ctx.streamPollMs);
    }

    async function poll(): Promise<void> {
        if (ended) return;
        try {
            const run = await ctx.store.runs.findOne(runId);
            if (ended) return;
            if (!run) {
                cleanup();
                return;
            }
            let sent = false;
            // the engine appends a step before it bumps the run: an unchanged run has no new steps
            const changed = isNewer(run, lastRun) || usageChanged(run, lastRun);
            if (changed) sent = sendRun(run);
            if (sent && isSettled(run)) {
                await settle();
                return;
            }
            if (changed && sendSteps(await ctx.store.steps.find(runId))) sent = true;
            if (!sent) write({ event: 'ping', data: '' });
        } catch (error) {
            fail(error);
            return;
        }
        arm();
    }

    ctx.closers.add(cleanup);
    if (signal.aborted) {
        cleanup();
        return stream.response;
    }
    signal.addEventListener('abort', cleanup, { once: true });

    let run: Run | undefined;
    let steps: Step[];
    try {
        run = await ctx.store.runs.findOneOrFail(runId);
        steps = await ctx.store.steps.find(runId);
    } catch (error) {
        // nothing was written yet: the error handler answers instead
        cleanup();
        throw error;
    }
    sendRun(run);
    sendSteps(steps);
    if (isSettled(run)) {
        cleanup();
        return stream.response;
    }

    ready = true;
    const replay = [...buffered];
    buffered.length = 0;
    for (const e of replay) {
        if (e.type === 'run.updated' && !isNewer(e.run, lastRun)) continue;
        live(e);
    }
    arm();
    return stream.response;
}
