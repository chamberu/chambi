/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';

/** The parts of a GitHub webhook body chamvi reads; the rest passes through. */
export type GithubPayload = {
    action?: string;
    installation?: { id: number };
    repository?: { full_name: string; [key: string]: unknown };
    sender?: {
        login: string;
        type: string;
        [key: string]: unknown
    };
    issue?: { number: number; [key: string]: unknown };
    pull_request?: { number: number; [key: string]: unknown };
    [key: string]: unknown;
};

/** The envelope payload of a run the GitHub channel started. */
export type GithubEvent = {
    /** X-GitHub-Event, e.g. 'issues'; not covered by the signature, so never a key on its own. */
    name: string;
    action?: string;
    /** X-GitHub-Delivery; not covered by the signature. */
    delivery: string;
    installationId?: number;
    payload: GithubPayload;
};

export type GithubSubscriptionOptions = {
    /** Shared-store execution cap within the agent; omitted or false adds no cap. */
    concurrencyMaxRuns?: number | false;
    /** Default `github:<events joined by ','>`. */
    id?: string;
    /** Runs after the event match; a delivery it refuses starts no run of this subscription. */
    filter?: (event: GithubEvent) => boolean;
    /**
     * Default: the delivery id (applied by the channel). The signature does not
     * cover that header, so a replayed body under a new id is a new run;
     * derive the key from the content on an exposed endpoint.
     */
    idempotencyKey?: (event: GithubEvent) => string | undefined;
    /** Default: `<full_name>#<issue|pull_request number>`, else `<full_name>`. */
    concurrencyKey?: (event: GithubEvent) => string | undefined;
    /**
     * Events (`name` or `name.action`) the App's own bot may start this
     * subscription with, e.g. `['pull_request.opened',
     * 'pull_request.synchronize', 'check_suite.completed']` for the pull
     * requests the agent opens or pushes to. Every other delivery the bot
     * sent dispatches nothing (the loop guard). A bare `pull_request` also
     * takes the `labeled`, `closed`, ... the agent's own tools cause, so it
     * starts again after each of its writes: name the actions. The agent's
     * first subscription matching the event whose `selfEvents` name it is
     * the one started.
     * `issue_comment`, `issues` and `pull_request_review_comment` are
     * refused (InvalidAgentDefinitionError): the bot's own comment would
     * start the agent again.
     */
    selfEvents?: readonly string[];
};

/** An issue or pull request, for `github.to()`. */
export type GithubTarget = {
    /** `owner/name`. */
    repo: string;
    /** The issue or pull request number. */
    number: number;
};

/** Makes GitHub subscriptions and addresses for one channel name. */
export type GithubSubscriber = {
    /**
     * A subscription to deliveries of `events`: `'issues'` (every action) or
     * `'issues.opened'`, one or several.
     */
    on(events: string | readonly string[], options?: GithubSubscriptionOptions): ChannelSubscription<GithubEvent>;
    /** The address of an issue or pull request, `<owner>/<repo>#<number>`. */
    to(target: GithubTarget): string;
};
