/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelMessage, TriggerEnvelope } from '@chamvi/core';
import { createGithubApp } from '@chamvi/github';
import type { GithubAppOptions, GithubEvent } from '@chamvi/github';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';

export const OUT_START = new Date('2026-10-21T09:00:00Z');

/** A fake GitHub with issue octo/demo#7 and an App on it (slug `chamvi-test`, no `GET /app`). */
export function createCommentFixture(app: Partial<GithubAppOptions> = {}) {
    const clock = new ControllableClock(OUT_START);
    const fake = createFakeGithub({
        appId: '123',
        slug: 'chamvi-test',
        clock,
    });

    fake.issues.set('octo/demo#7', {
        number: 7,
        title: 'Deploy please',
        state: 'open',
    });

    const gh = createGithubApp({
        appId: '123',
        privateKey: fake.privateKey,
        webhookSecret: 'webhook-secret',
        slug: 'chamvi-test',
        clock,
        fetch: fake.fetch,
        ...app,
    });

    return {
        clock,
        fake,
        gh,
    };
}

/** A GithubEvent for octo/demo, an issue unless `payload` says otherwise. */
export function githubEvent(patch: Partial<GithubEvent> = {}): GithubEvent {
    return {
        name: 'issues',
        action: 'opened',
        delivery: 'd-1',
        installationId: 42,
        payload: {
            repository: { full_name: 'octo/demo' },
            issue: { number: 7 },
        },
        ...patch,
    };
}

/** The envelope of a run the `channel` channel (default `github`) started from `event`. */
export function githubTrigger(event: GithubEvent = githubEvent(), channel = 'github'): TriggerEnvelope {
    return {
        id: 'e1',
        agent: 'release',
        trigger: 'github:issues.opened',
        channel,
        payload: event,
        address: 'octo/demo#7',
        receivedAt: OUT_START,
    };
}

export function httpTrigger(): TriggerEnvelope {
    return {
        id: 'e2',
        agent: 'release',
        trigger: 'http',
        channel: 'http',
        payload: {},
        receivedAt: OUT_START,
    };
}

/** An approval message as the engine sends it (key `<runId>:<approvalId>`). */
export const APPROVAL: ChannelMessage = {
    kind: 'approval',
    key: 'r1:a1',
    agent: 'release',
    runId: 'r1',
    title: 'Close octo/demo#7?',
    body: 'It duplicates #3.\n{"repo":"octo/demo","number":7}',
    approvalId: 'a1',
    expiresAt: new Date('2026-10-22T09:00:00Z'),
};
