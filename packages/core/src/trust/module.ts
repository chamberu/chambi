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
    source: { channel: string; address?: string };
};

const executions = new WeakMap<RunContext, TrustState>();

export function bindTrust(run: RunContext, options: Omit<TrustState, 'pending' | 'failure' | 'failed' | 'source'>): void {
    // snapshot the notification target: tool code may write to ctx.run.trigger later
    const { channel, address } = run.trigger;

    executions.set(run, { ...options, source: { channel, ...(address !== undefined ? { address } : {}) } });
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

export async function gateOutbound(ctx: Pick<ToolContext, 'run'>, name: string, input: unknown): Promise<void> {
    const state = executions.get(ctx.run);

    if (!state) {
        throw new InvalidRunStateError('Outbound execution requires an execution-bound trust context.');
    }

    await state.pending;
    assertTrust(ctx.run);

    if (!state.taint) {
        return;
    }

    if (state.policy?.onTainted === 'deny') {
        throw new ToolDeniedError('Outbound execution denied after exposure to untrusted content.');
    }

    const decision = await requestApproval({
        title: 'Approve outbound execution from an untrusted run?',
        body: JSON.stringify({
            tool: name,
            input,
            taint: state.taint,
        }),
        // Bind replay to the final arguments, independently of tool-call ids.
        binding: stableHash({ name, input }),
        notification: 'An outbound operation requires review in the approval inbox.',
    }, state.source.address && state.engine?.getChannel(state.source.channel)?.out ? {
        channel: state.source.channel,
        address: state.source.address,
    } : {});

    if (!decision.approved) {
        throw new ToolDeniedError('Outbound execution was not approved.');
    }
}
