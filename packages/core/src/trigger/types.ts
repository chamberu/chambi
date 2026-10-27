/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Artifact } from '../artifact/types.ts';

/**
 * Who started a run (or answered an approval), as an authenticator resolved
 * it: a snapshot of identity and grants taken at dispatch, never a token.
 * Revoking a grant later does not reach a run that already holds it.
 */
export type Invoker = {
    id: string;
    /**
     * The authenticator's label: `@chamvi/http`'s staticTokens() sets
     * 'token' and authup() sets 'authup'; oidc() keeps the kind its
     * `principal` mapper returns (the docs use 'oidc'); a custom authenticator
     * or a direct dispatch may use its own (e.g. 'user').
     */
    kind: string;
    name?: string;
    permissions: readonly string[];
};

/**
 * The run that started this one. Only startHandoff() sets it (kind
 * `handoff`); a dispatch never carries one, so no caller forges lineage.
 */
export type TriggerParent = {
    kind: 'handoff';
    runId: string;
    agent: string;
    depth: number;
};

export type TriggerEnvelope<P = unknown> = {
    id: string;
    agent: string;
    /** The id of the agent's subscription that started the run. */
    trigger: string;
    /** The name of the channel the run came from. */
    channel: string;
    payload: P;
    idempotencyKey?: string;
    concurrencyKey?: string;
    /** Where the run came from on that channel (an issue, a thread, a caller); the channel defines it. */
    address?: string;
    /** Files the run was started with, stored as artifacts of the run; the model gets them as file parts. */
    attachments?: Artifact[];
    /**
     * Who started the run; only ever set from an authenticator (never from a
     * payload). Absent for runs a channel started without one (cron, webhooks). With an invoker the
     * idempotency key is scoped to it, so only the same invoker's dispatch
     * is deduplicated (and gets its own first run).
     */
    invoker?: Invoker;
    /** The run that handed this one off; set only by startHandoff(), never from a dispatch. */
    parent?: TriggerParent;
    receivedAt: Date;
};
