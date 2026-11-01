/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { requestApproval } from '../approval/request.ts';
import type { IEngine } from '../engine/types.ts';
import { stableHash } from '../effect/helpers.ts';
import { InvalidRunStateError, ToolDeniedError } from '../errors/index.ts';
import type { RunContext, RunTaint } from '../run/types.ts';
import type { AgentTrust, ToolContext } from '../tool/types.ts';
import type { RunSource } from './types.ts';

type TrustState = {
    taint?: RunTaint;
    pending?: Promise<void>;
    failed?: boolean;
    failure?: unknown;
    policy?: AgentTrust;
    now: () => Date;
    persist: (taint: RunTaint) => Promise<unknown>;
    engine?: Pick<IEngine, 'getChannel'>;
    /** The run's source channel and address when the trust context was bound, never the mutable `run.trigger`. */
    source: RunSource;
};

const executions = new WeakMap<RunContext, TrustState>();

export function bindTrust(run: RunContext, options: Omit<TrustState, 'pending' | 'failure' | 'failed' | 'source'>): void {
    // snapshot the notification target: tool code may write to ctx.run.trigger later
    const { channel, address } = run.trigger;

    executions.set(run, { ...options, source: { channel, ...(address !== undefined ? { address } : {}) } });
}

/**
 * The run's source channel and address as the engine bound them when the
 * execution started, unaffected by tool code writing to `ctx.run.trigger`.
 * `undefined` for a context the engine did not build. Trust classifiers that
 * exempt the source destination read this, never `ctx.run.trigger`.
 */
export function runSource(ctx: Pick<ToolContext, 'run'>): RunSource | undefined {
    const source = ctx?.run ? executions.get(ctx.run)?.source : undefined;

    return source ? { ...source } : undefined;
}

/** Persistence failure is fatal to the execution, never a usable tool result. */
export function assertTrust(run: RunContext, required = false): void {
    const state = executions.get(run);

    if (required && !state) {
        throw new InvalidRunStateError('Classified tools require an execution-bound trust context.');
    }

    if (state?.failed) {
        throw state.failure;
    }
}

export async function markUntrusted(ctx: Pick<ToolContext, 'run'>, source: string): Promise<void> {
    const state = executions.get(ctx.run);

    if (!state) {
        throw new InvalidRunStateError('Untrusted content requires an execution-bound trust context.');
    }

    assertTrust(ctx.run);

    if (state.pending) {
        await state.pending;

        return;
    }

    if (state.taint) {
        return;
    }

    const taint = { at: state.now(), source };

    // Share the first write, including its failure, across parallel tool calls.
    state.pending = Promise.try(async () => {
        try {
            await state.persist(taint);
            state.taint = taint;
        } catch (error) {
            state.failed = true;
            state.failure = error;

            throw error;
        }
    });
    await state.pending;
}

/**
 * The outbound gate: nothing in an untainted run (false), a ToolDeniedError
 * under `onTainted: 'deny'`, else the bound approval (true once approved).
 * `detail` (a tool's `approvalDetail`) joins the private body and the binding.
 */
export async function gateOutbound(
    ctx: Pick<ToolContext, 'run'>,
    name: string,
    input: unknown,
    detail?: () => string | undefined | Promise<string | undefined>,
): Promise<boolean> {
    const state = executions.get(ctx.run);

    if (!state) {
        throw new InvalidRunStateError('Outbound execution requires an execution-bound trust context.');
    }

    await state.pending;
    assertTrust(ctx.run);

    if (!state.taint) {
        return false;
    }

    if (state.policy?.onTainted === 'deny') {
        throw new ToolDeniedError('Outbound execution denied after exposure to untrusted content.');
    }

    const extra = await detail?.();

    const decision = await requestApproval({
        title: 'Approve outbound execution from an untrusted run?',
        body: JSON.stringify({
            tool: name,
            input,
            taint: state.taint,
            ...(extra !== undefined && { detail: extra }),
        }),
        // Bind replay to the final arguments (and the detail), independently of tool-call ids.
        binding: stableHash(extra === undefined ? { name, input } : {
            name,
            input,
            detail: extra,
        }),
        notification: 'An outbound operation requires review in the approval inbox.',
    }, state.source.address && state.engine?.getChannel(state.source.channel)?.out ? {
        channel: state.source.channel,
        address: state.source.address,
    } : {});

    if (!decision.approved) {
        throw new ToolDeniedError('Outbound execution was not approved.');
    }

    return true;
}
