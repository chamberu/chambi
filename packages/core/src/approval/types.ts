/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolCallFrame } from '../effect/types.ts';
import type { ApprovalRequest } from '../engine/execute/types.ts';
import type { Invoker } from '../trigger/types.ts';

/** One choice of an approval request; `detail` is shown in the UI only (e.g. a diff). */
export type ApprovalOption = {
    id: string;
    label: string;
    detail?: string;
};

/** What a tool asks the owner to approve (`approve()`, `ChannelHandle.approve()`). */
export type ApprovalRequestInput = {
    title: string;
    body?: string;
    /** Choices to pick from; without them the approval is a plain yes or no. */
    options?: ApprovalOption[];
    /** Several options may be selected; default one. Needs `options`. */
    multiple?: boolean;
    /** How long the approval waits before it is denied; default 24 h. */
    timeoutMs?: number;
};

/** The owner's answer to an approval request. */
export type ApprovalDecision = {
    approved: boolean;
    reason?: string;
    /** Who answered, when known. */
    approver?: Invoker;
    /** The selected option ids in the request's option order; only on an approval of a request with options. */
    selected?: string[];
};

/** A plain approval ordinal taken before any await (internal, not exported): see reserveApproval(). */
export type ApprovalReservation = {
    frame: ToolCallFrame;
    choice: Pick<ApprovalRequest, 'options' | 'multiple'>;
    ordinal: number;
};
