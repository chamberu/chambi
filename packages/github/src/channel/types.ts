/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    ChannelRequest,
    IChannel,
    IClock,
    IStore,
} from '@chamvi/core';
import type { IGithubApp } from '../app/types.ts';
import type { GithubSubscriber } from '../subscription/types.ts';

// #region public
/** What `approvalUrl` gets: ids only, never a token. */
export type GithubApprovalRef = {
    runId: string;
    approvalId: string;
    agent: string;
};

export type GithubChannelOptions = {
    app: IGithubApp;
    /** The channel name; default `'github'`. A second instance needs its own. */
    name?: string;
    /** Persistent-comment coordination; defaults to local memory. Share across replicas. */
    locks?: IStore['locks'];
    /** Logins mentioned at the top of every comment (without `@`). */
    mention?: string | readonly string[];
    /**
     * A link to the approval in the chamvi UI, e.g.
     * `https://<app>/ui/approvals?run=<runId>&approval=<approvalId>`, where the
     * signed-in owner answers it; it carries no token.
     */
    approvalUrl?: (ref: GithubApprovalRef) => string;
    /** Bound of one comment send; default `GITHUB_CHANNEL_TIMEOUT_MS` (30 s). */
    timeoutMs?: number;
    /** Bytes a delivery may have (413 above); default 1 MiB. */
    bodyLimit?: number;
    /**
     * Receives each agent a delivery could not be dispatched to (a throwing
     * filter or key function, a refused key, a failed dispatch); the delivery
     * is then answered 500. Default `console.error('[chamvi]', error)`.
     */
    onError?: (error: unknown) => void;
    clock?: IClock;
};

/** The GitHub channel: deliveries `in`, issue and pull request comments `out`, with `on()` and `to()` bound to its name. */
export type GithubChannel = IChannel<ChannelRequest, Response> & GithubSubscriber;
// #endregion public

export type CommentTarget = {
    owner: string;
    repo: string;
    number: number;
};

export type ResolvedGithubChannelOptions = {
    app: IGithubApp;
    name: string;
    locks: IStore['locks'];
    mentions: string[];
    approvalUrl?: (ref: GithubApprovalRef) => string;
    timeoutMs: number;
    bodyLimit: number;
    onError: (error: unknown) => void;
    clock: IClock;
};
