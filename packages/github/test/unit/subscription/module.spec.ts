/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, ValidationError, defineAgent } from '@chamvi/core';
import { github, githubChannel } from '@chamvi/github';
import type { GithubEvent } from '@chamvi/github';
import { defaultConcurrencyKey, matchesGithubSubscription } from '../../../src/subscription/helpers.ts';
import { createGithubFixture } from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

function event(overrides: Partial<GithubEvent> = {}): GithubEvent {
    return {
        name: 'issues',
        action: 'opened',
        delivery: 'd-1',
        installationId: 42,
        payload: {
            action: 'opened',
            repository: { full_name: 'o/r' },
            issue: { number: 5 },
        },
        ...overrides,
    };
}

describe('github.on', () => {
    it('builds a subscription of the github channel', () => {
        const subscription = github.on(['issues.opened', 'pull_request']);

        expect(subscription.channel).toBe('github');
        expect(subscription.id).toBe('github:issues.opened,pull_request');
        expect(subscription.options.events).toEqual(['issues.opened', 'pull_request']);
        expect(subscription).not.toHaveProperty('idempotencyKey');
        expect(subscription.concurrencyKey).toBeTypeOf('function');
    });

    it('takes one event as a string', () => {
        const subscription = github.on('issues.opened');

        expect(subscription.id).toBe('github:issues.opened');
        expect(subscription.options.events).toEqual(['issues.opened']);
    });

    it('takes an explicit id', () => {
        expect(github.on('issues', { id: 'github:triage' }).id).toBe('github:triage');
    });

    it('copies the events', () => {
        const events = ['issues'];
        const subscription = github.on(events);

        events.push('pull_request');
        expect(subscription.options.events).toEqual(['issues']);
    });

    it('accepts event names with digits (Projects v2)', () => {
        const subscription = github.on(['projects_v2_item.created', 'projects_v2']);

        expect(subscription.options.events).toEqual(['projects_v2_item.created', 'projects_v2']);
    });

    it.each([
        [[]],
        [['Issues']],
        [['issues.']],
        [['a.b.c']],
        [['']],
        [['issues opened']],
        ['Issues'],
    ])('refuses the events %j', (events) => {
        expect(() => github.on(events as string[])).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses an empty id', () => {
        expect(() => github.on('issues', { id: '' })).toThrow(InvalidAgentDefinitionError);
    });

    it('keeps the given idempotency key function', () => {
        const subscription = github.on('issues', { idempotencyKey: (e) => `issue:${e.payload.issue?.number}` });

        expect(subscription.idempotencyKey?.(event())).toBe('issue:5');
    });

    it('a channel instance subscribes under its own name', () => {
        const { gh } = createGithubFixture();
        const enterprise = githubChannel({ app: gh, name: 'github-ent' });
        const subscription = enterprise.on('issues.opened');

        expect(subscription.channel).toBe('github-ent');
        expect(subscription.id).toBe('github:issues.opened');
    });
});

describe('github.to', () => {
    it('builds the address of an issue or pull request', () => {
        expect(github.to({ repo: 'octo/demo', number: 5 })).toBe('octo/demo#5');

        const { gh } = createGithubFixture();

        expect(githubChannel({ app: gh }).to({ repo: 'octo/demo', number: 7 })).toBe('octo/demo#7');
    });

    it.each([
        [{ repo: 'octo', number: 5 }],
        [{ repo: 'a/../b', number: 5 }],
        [{ repo: 'octo/demo', number: 0 }],
        [{ repo: 'octo/demo', number: 1.5 }],
    ])('refuses %j', (target) => {
        expect(() => github.to(target)).toThrow(ValidationError);
    });
});

describe('matchesGithubSubscription', () => {
    it('matches name and action', () => {
        const opened = github.on('issues.opened');

        expect(matchesGithubSubscription(opened, 'github', event())).toBe(true);
        expect(matchesGithubSubscription(opened, 'github', event({ action: 'closed' }))).toBe(false);
        expect(matchesGithubSubscription(opened, 'github', event({ name: 'issue_comment', action: 'opened' }))).toBe(false);
        expect(matchesGithubSubscription(opened, 'github', event({ action: undefined }))).toBe(false);
    });

    it('matches any action of a bare event name', () => {
        const issues = github.on('issues');

        expect(matchesGithubSubscription(issues, 'github', event({ action: 'closed' }))).toBe(true);
        expect(matchesGithubSubscription(issues, 'github', event({ name: 'ping', action: undefined }))).toBe(false);
    });

    it('matches any of several events', () => {
        const subscription = github.on(['issues.opened', 'pull_request']);

        expect(matchesGithubSubscription(subscription, 'github', event({ name: 'pull_request', action: 'synchronize' }))).toBe(true);
    });

    it('never matches a subscription of another channel', () => {
        const forged = { ...github.on('issues'), channel: 'webhook' };

        expect(matchesGithubSubscription(forged, 'github', event())).toBe(false);
        expect(matchesGithubSubscription(github.on('issues'), 'github-ent', event())).toBe(false);
        expect(matchesGithubSubscription({
            channel: 'github',
            id: 'x',
            options: {},
        }, 'github', event())).toBe(false);
    });

    it('applies the filter after the event match', () => {
        const seen: GithubEvent[] = [];
        const subscription = github.on('issues.opened', {
            filter: (e) => {
                seen.push(e);

                return e.payload.issue?.number === 5;
            },
        });

        expect(matchesGithubSubscription(subscription, 'github', event({ action: 'closed' }))).toBe(false);
        expect(seen).toHaveLength(0);
        expect(matchesGithubSubscription(subscription, 'github', event())).toBe(true);
        expect(matchesGithubSubscription(subscription, 'github', event({ payload: { issue: { number: 6 } } }))).toBe(false);
        expect(seen).toHaveLength(2);
    });

    it('propagates a throwing filter', () => {
        const subscription = github.on('issues', {
            filter: () => {
                throw new TypeError('bad filter');
            },
        });

        expect(() => matchesGithubSubscription(subscription, 'github', event())).toThrow('bad filter');
    });
});

describe('default concurrency key', () => {
    it('keys issues and pull requests by repository and number', () => {
        expect(defaultConcurrencyKey(event())).toBe('o/r#5');
        expect(defaultConcurrencyKey(event({
            name: 'pull_request',
            payload: { repository: { full_name: 'o/r' }, pull_request: { number: 7 } },
        }))).toBe('o/r#7');
    });

    it('falls back to the repository, then to none', () => {
        expect(defaultConcurrencyKey(event({ payload: { repository: { full_name: 'o/r' } } }))).toBe('o/r');
        expect(defaultConcurrencyKey(event({ payload: {} }))).toBeUndefined();
    });

    it('is the subscription default, and a given concurrencyKey wins', () => {
        expect(github.on('issues').concurrencyKey?.(event())).toBe('o/r#5');

        const own = github.on('issues', { concurrencyKey: () => 'mine' });

        expect(own.concurrencyKey?.(event())).toBe('mine');
    });
});

describe('agents', () => {
    it('accept two github subscriptions with distinct ids and refuse equal ones', () => {
        const base = {
            name: 'triage',
            model: textModel(),
            instructions: 'Triage.',
        };

        expect(() => defineAgent({
            ...base,
            channels: [
                github.on('issues.opened'),
                github.on('issues.opened', { id: 'github:other' }),
            ],
        })).not.toThrow();
        expect(() => defineAgent({
            ...base,
            channels: [
                github.on('issues.opened'),
                github.on('issues.opened'),
            ],
        })).toThrow(InvalidAgentDefinitionError);
    });
});
