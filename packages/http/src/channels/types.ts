/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelRequest, IChannel } from '@chamvi/core';
import type { Authenticator } from '../auth/types.ts';
import type { WebhookSubscriber } from '../subscriptions/types.ts';

/** Options of `httpChannel()` and `mcpChannel()`. */
export type HttpChannelOptions = {
    /**
     * Taint every run started through this channel (`channel:<name>`), so
     * classified outbound tools need approval; default false (the caller is
     * an authenticated principal). Set it when principals relay content you
     * do not trust.
     */
    untrusted?: boolean;
};

export type WebhookChannelOptions = {
    /** The channel name; default `webhook`. A second instance needs its own. */
    name?: string;
    /**
     * Who may deliver: the first principal wins (as the http app's `auth`),
     * and it needs `agent:<agent>:run`. Required, since the http app never
     * authenticates channel routes.
     */
    auth: Authenticator | Authenticator[];
    /** Bytes a delivery may have (413 above). Default: 1 MiB, the http app's default. */
    bodyLimit?: number;
};

/** A webhook channel: `in` only, with `on()` bound to its name. */
export type WebhookChannel = IChannel<ChannelRequest, Response> & WebhookSubscriber;

/** A webhook delivery's target, parsed from the subpath; internal. */
export type WebhookTarget = {
    agent: string;
    /** Starts with `/`, the decoded segments joined with `/`. */
    path: string;
};
