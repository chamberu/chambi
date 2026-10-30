/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, ValidationError, assertConcurrencyMaxRuns } from '@chamvi/core';
import type { ChannelSubscription } from '@chamvi/core';
import { isObject } from 'smob';
import { GITHUB_CHANNEL_NAME } from '../channel/constants.ts';
import { GITHUB_EVENT_PATTERN } from './constants.ts';
import {
    assertSelfEvents,
    defaultConcurrencyKey,
    isPositiveInteger,
    isRepo,
} from './helpers.ts';
import type {
    GithubEvent,
    GithubSubscriber,
    GithubSubscriptionOptions,
    GithubTarget,
} from './types.ts';

/**
 * A subscription of `channel` (a GitHub channel's name) to deliveries of
 * `events`, matched by event name and optional action (`'issues'`,
 * `'issues.opened'`); the run payload is a `GithubEvent`. Throws
 * InvalidAgentDefinitionError without events, for a malformed one, an
 * empty id or a `selfEvents` entry that is malformed or refused.
 */
export function createGithubSubscription(
    channel: string,
    events: string | readonly string[],
    options: GithubSubscriptionOptions = {},
): ChannelSubscription<GithubEvent> {
    assertConcurrencyMaxRuns(options.concurrencyMaxRuns, 'github.on() concurrencyMaxRuns');

    let list: unknown[] = [];

    if (typeof events === 'string') {
        list = [events];
    } else if (Array.isArray(events)) {
        list = [...events];
    }

    if (list.length === 0) {
        throw new InvalidAgentDefinitionError('github.on() needs at least one event.');
    }

    for (const spec of list) {
        if (typeof spec !== 'string' || !GITHUB_EVENT_PATTERN.test(spec)) {
            throw new InvalidAgentDefinitionError(`GitHub event "${String(spec)}" must look like "issues" or "issues.opened".`);
        }
    }

    const id = options.id ?? `github:${list.join(',')}`;

    if (typeof id !== 'string' || id.length === 0) {
        throw new InvalidAgentDefinitionError('A github.on() id must not be empty.');
    }

    const selfEvents = assertSelfEvents(options.selfEvents);

    const subscription: ChannelSubscription<GithubEvent> = {
        channel,
        id,
        ...(options.concurrencyMaxRuns !== undefined ? { concurrencyMaxRuns: options.concurrencyMaxRuns } : {}),
        options: {
            events: list,
            ...(options.filter ? { filter: options.filter } : {}),
            ...(selfEvents ? { selfEvents } : {}),
        },
        concurrencyKey: options.concurrencyKey ?? defaultConcurrencyKey,
    };

    if (options.idempotencyKey) {
        subscription.idempotencyKey = options.idempotencyKey;
    }

    return subscription;
}

/**
 * The address of an issue or pull request, `<owner>/<repo>#<number>`;
 * ValidationError for a repository that is not `owner/name` or a number
 * that is no positive integer.
 */
export function githubAddress(target: GithubTarget): string {
    const repo = isObject(target) ? target.repo : undefined;
    const number = isObject(target) ? target.number : undefined;

    if (!isRepo(repo)) {
        throw new ValidationError(`repo must look like "owner/name", got ${JSON.stringify(repo)}.`);
    }

    if (!isPositiveInteger(number)) {
        throw new ValidationError('number must be a positive integer.');
    }

    return `${repo}#${number}`;
}

/**
 * Subscriptions and addresses for the default GitHub channel
 * (`githubChannel()`, named `github`): `github.on('issues.opened')`,
 * `github.to({ repo: 'octo/demo', number: 12 })`. Pure data, so agent
 * folders use it without a channel instance; a second GitHub channel makes
 * its subscriptions with its own `on()`.
 */
export const github: GithubSubscriber = {
    on: (events, options) => createGithubSubscription(GITHUB_CHANNEL_NAME, events, options),
    to: githubAddress,
};
