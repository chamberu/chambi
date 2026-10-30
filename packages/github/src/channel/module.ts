/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { registerChannelName } from '../app/helpers.ts';
import { createGithubSubscription, githubAddress } from '../subscription/module.ts';
import { receiveDelivery } from '../webhook/module.ts';
import { resolveOptions } from './helpers.ts';
import { createCommentSender } from './out.ts';
import type { GithubChannel, GithubChannelOptions } from './types.ts';

/**
 * The GitHub channel of a GitHub App. `in` takes the App's webhook
 * deliveries (served by the http app at `POST /channels/<name>`): it checks
 * the signature over the raw body and dispatches one run per agent with a
 * matching `github.on()` subscription (its first one), with the address of
 * the event's issue or pull request, deduplicated by the delivery id; it
 * answers `202 { delivery, runs }`, also for ping, unmatched and self-sent
 * events. `out` comments on an issue or pull request (`owner/repo#n`, e.g.
 * the run's source address), at most once per message key. Throws
 * InvalidAgentDefinitionError for an invalid option.
 */
export function githubChannel(options: GithubChannelOptions): GithubChannel {
    const resolved = resolveOptions(options);
    const { name } = resolved;

    // the app's tools then act as the delivery's installation for runs of this channel
    registerChannelName(resolved.app, name);

    return {
        name,
        in: (input, ctx) => receiveDelivery(input, ctx, resolved),
        out: createCommentSender(resolved),
        on: (events, subscriptionOptions) => createGithubSubscription(name, events, subscriptionOptions),
        to: githubAddress,
    };
}
