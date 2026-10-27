/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunWire } from '../api/types.ts';

export type AnswerResult = 'answered' | 'already-answered' | 'forbidden';

/** An answer given from the inbox: the run as it was answered, and how it went. */
export type DecidedApproval = {
    run: RunWire;
    result: AnswerResult;
    approved: boolean;
    reason?: string;
    /** Who answered (the signed-in principal's name or id) and when (ISO). */
    by?: string;
    at?: string;
};

/** The callout's "notified" line. */
export type NotifiedLine = { text: string; warn: boolean };

/** A token-less approval link: `/approvals?run=<runId>&approval=<approvalId>` (approval optional). */
export type ApprovalLink = { runId: string; approvalId?: string };

/** Why a linked approval can no longer be answered here. */
export type MovedOnReason = 'not-waiting' | 'other-approval' | 'expired';

/** Where a linked approval stands for the signed-in principal. */
export type LinkedApprovalState =    { kind: 'loading' } |
    { kind: 'pending'; run: RunWire } |
    { kind: 'forbidden'; run: RunWire } |
    { kind: 'answered'; run: RunWire } |
    {
        kind: 'moved-on'; 
        reason: MovedOnReason; 
        run: RunWire 
    } |
    { kind: 'unreadable' } |
    { kind: 'not-found' } |
    { kind: 'failed'; message: string };

/** The notice above the inbox for a linked approval that cannot be answered. */
export type LinkNotice = {
    /** 403 for a missing grant. */
    status?: 403;
    text: string;
    /** The run to link to, when the principal can open it. */
    runId?: string;
};

/** One line of an option's detail; `kind` only for the lines of a diff. */
export type DetailLine = {
    text: string;
    kind?: 'add' | 'del' | 'hunk'
};
