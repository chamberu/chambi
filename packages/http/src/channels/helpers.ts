/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IChannel, IEngine } from '@chamvi/core';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { WebhookTarget } from './types.ts';

const WEBHOOK_CHANNELS = new WeakSet<object>();

/** Records `channel` as made by webhookChannel(), so `GET /agents` can list hook URLs. */
export function markWebhookChannel(channel: object): void {
    WEBHOOK_CHANNELS.add(channel);
}

/** Whether `channel` was made by this package's webhookChannel(). */
export function isWebhookChannel(channel: unknown): boolean {
    // WeakSet.has answers false for a non-object
    return WEBHOOK_CHANNELS.has(channel as object);
}

/**
 * The channels an http app mounts: each with an `in`, the very object the
 * engine holds under its name, listed once; else InvalidAgentDefinitionError.
 */
export function validateChannels(engine: IEngine, channels: readonly IChannel[] | undefined): IChannel[] {
    const seen = new Set<string>();

    return (channels ?? []).map((channel) => {
        const name = String(channel?.name);

        if (typeof channel?.in !== 'function') {
            throw new InvalidAgentDefinitionError(`The channel "${name}" has no in() for the http app to serve.`);
        }

        if (engine.getChannel(name) !== channel) {
            throw new InvalidAgentDefinitionError(`The engine holds no channel "${name}" as given to the http app.`);
        }

        if (seen.has(name)) {
            throw new InvalidAgentDefinitionError(`The channel "${name}" is listed more than once.`);
        }

        seen.add(name);

        return channel;
    });
}

/**
 * A webhook delivery's agent and path from the raw subpath
 * (`/<agent>[/<path>]`, each segment percent-decoded); `undefined` without
 * an agent or for a segment that does not decode.
 */
export function parseWebhookSubpath(subpath: string): WebhookTarget | undefined {
    const [, agent = '', ...rest] = subpath.split('/');

    try {
        const decoded = [agent, ...rest].map((segment) => decodeURIComponent(segment));

        if (!decoded[0]) {
            return undefined;
        }

        return { agent: decoded[0], path: `/${decoded.slice(1).join('/')}` };
    } catch {
        return undefined;
    }
}

/** Where a webhook subscription on `path` is served, each segment URL-encoded. */
export function webhookUrl(basePath: string, channel: string, agent: string, path: string): string {
    const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');

    return `${basePath}/channels/${channel}/${agent}${encoded === '/' ? '' : encoded}`;
}
