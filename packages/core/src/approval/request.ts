/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { currentToolCall } from '../effect/frame.ts';
import type { ApprovalRequest } from '../engine/execute/types.ts';
import {
    ChamviError,
    ErrorCode,
    InvalidRunStateError,
    ValidationError,
} from '../errors/index.ts';
import type { StateSchema } from '../state/types.ts';
import type { ToolContext } from '../tool/types.ts';
import { APPROVAL_TIMEOUT_MAX_MS, DEFAULT_APPROVAL_TIMEOUT_MS } from './constants.ts';
import {
    approvalDecisionKey,
    fitRecordedDecision,
    toApprovalDecision,
    toApprovalOptions,
} from './helpers.ts';
import type { ApprovalDecision, ApprovalRequestInput } from './types.ts';

/**
 * Thrown by approve() to suspend its tool call until the approval is
 * answered (internal). The tool-call wrapper catches it; a ChamviError so
 * that a leaked one still reads as what it is.
 */
export class SuspendSignal extends ChamviError {
    readonly request: ApprovalRequest;

    constructor(request: ApprovalRequest) {
        super({
            message: `The tool call "${request.toolName}" is suspended until approval "${request.approvalId}" is answered.`,
            code: ErrorCode.INVALID_RUN_STATE,
        });
        this.request = request;
    }
}

function assertRequest(request: unknown): Pick<ApprovalRequest, 'options' | 'multiple'> {
    if (!isObject(request)) {
        throw new ValidationError('An approval request must be an object.');
    }

    if (typeof request.title !== 'string' || request.title.length === 0) {
        throw new ValidationError('An approval request needs a non-empty title.');
    }

    if (request.body !== undefined && typeof request.body !== 'string') {
        throw new ValidationError('An approval request body must be a string.');
    }

    const { timeoutMs } = request;

    if (
        timeoutMs !== undefined &&
        (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > APPROVAL_TIMEOUT_MAX_MS)
    ) {
        throw new ValidationError(`An approval timeoutMs must be an integer from 1 to ${APPROVAL_TIMEOUT_MAX_MS}.`);
    }

    return toApprovalOptions(request.options, request.multiple);
}

/**
 * The approval logic behind approve() and ChannelHandle.approve(): the n-th
 * request of the current tool call has the id `<stepIndex>:<toolCallId>:<n>`
 * (the step index of the model step that made the call, so a call id a
 * provider reuses in a later step is another approval); a decision
 * recorded for it is returned, otherwise the call is suspended (the request
 * is stashed on the frame and a SuspendSignal thrown). Sends nothing.
 */
export async function requestApproval(
    request: ApprovalRequestInput,
    target: { channel?: string; address?: string } = {},
): Promise<ApprovalDecision> {
    const frame = currentToolCall();

    if (!frame) {
        throw new InvalidRunStateError('approve() runs inside a tool call (its execute or the agent hooks), not in the tools factory.');
    }

    if (frame.streaming) {
        throw new InvalidRunStateError(
            `approve() cannot run in the body of the streaming tool "${frame.toolName}"; gate it in beforeToolExecution.`,
        );
    }

    const choice = assertRequest(request);
    // taken before any await, so the ordinals follow the order of the calls
    const approvalId = `${frame.stepIndex}:${frame.toolCallId}:${frame.approvals++}`;
    const recorded = await frame.effects.findOne(approvalDecisionKey(frame.runId, approvalId));

    if (recorded) {
        return fitRecordedDecision(toApprovalDecision(recorded.result), { approvalId, ...choice });
    }

    const pending: ApprovalRequest = {
        approvalId,
        toolName: frame.toolName,
        toolCallId: frame.toolCallId,
        title: request.title,
        ...(request.body !== undefined ? { body: request.body } : {}),
        ...choice,
        ...(target.channel !== undefined ? { channel: target.channel } : {}),
        ...(target.address !== undefined ? { address: target.address } : {}),
        timeoutMs: request.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
    };

    // the first suspension of the call wins, also when the tool catches the signal
    frame.suspended ??= pending;

    throw new SuspendSignal(pending);
}

/**
 * Asks the owner to approve, from inside a tool call (its `execute` or the
 * agent hooks), without a channel: the request waits in the inbox and the
 * API. The run pauses `waiting` until it is answered (or times out after
 * `timeoutMs`, default 24 h, denied); the call then runs again from the start
 * and this approve() returns the decision. Code before it runs again on
 * resume, so side effects there must be idempotent or effect tools.
 * Throws InvalidRunStateError outside a tool call and in a streaming tool's
 * body, ValidationError for an invalid request.
 */
export async function approve<S extends StateSchema = StateSchema>(
    ctx: ToolContext<S>,
    request: ApprovalRequestInput,
): Promise<ApprovalDecision> {
    const frame = currentToolCall();

    if (frame && ctx?.run?.runId !== undefined && ctx.run.runId !== frame.runId) {
        throw new InvalidRunStateError('approve() got the context of another run than the tool call it runs in.');
    }

    return requestApproval(request);
}
