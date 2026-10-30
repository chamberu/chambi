/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import type { Agent } from '@chamvi/core';
import { github, githubChannel } from '@chamvi/github';
import type { GithubEvent, GithubSubscriptionOptions } from '@chamvi/github';
import { createHttpApp, staticTokens } from '@chamvi/http';
import { createGithubFixture, createGithubTestApp, deliver } from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

const ISSUES_OPENED = readFileSync(new URL('../../fixtures/deliveries/issues-opened.json', import.meta.url), 'utf8');
const BOT_COMMENT = readFileSync(new URL('../../fixtures/deliveries/issue-comment-by-bot.json', import.meta.url), 'utf8');

type Subscription = GithubSubscriptionOptions & { events: string[] };

function agent(name: string, ...subscriptions: Subscription[]): Agent {
    return defineAgent({
        name,
        model: textModel(),
        instructions: name,
        channels: subscriptions.map(({ events, ...options }) => github.on(events, options)),
    });
}

function standardAgents(): Agent[] {
    return [
        agent('triage', { events: ['issues.opened'] }),
        agent('labels', { events: ['issues'] }),
        agent('other', { events: ['pull_request.opened'] }),
    ];
}

type Answer = {
    delivery: string;
    runs: Array<{
        agent: string; 
        runId: string; 
        deduplicated: boolean 
    }>;
};

describe('github channel in', () => {
    it('turns a recorded issues.opened delivery into one run per matching agent', async () => {
        const { app, store } = createGithubTestApp({ agents: standardAgents() });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(response.status).toBe(202);
        const answer = await response.json() as Answer;
        expect(answer.delivery).toBe('d-1');
        expect(answer.runs.map((r) => [r.agent, r.deduplicated])).toEqual([['triage', false], ['labels', false]]);

        for (const [index, subscriptionId] of ['github:issues.opened', 'github:issues'].entries()) {
            const run = await store.runs.findOne(answer.runs[index]!.runId);
            expect(run?.status).toBe('queued');
            expect(run?.address).toBe('octo/demo#5');
            expect(run?.trigger).toMatchObject({
                channel: 'github',
                trigger: subscriptionId,
                address: 'octo/demo#5',
                idempotencyKey: 'd-1',
                concurrencyKey: 'octo/demo#5',
            });
            expect(run?.trigger.invoker).toBeUndefined();
            expect(run?.trigger.payload).toEqual({
                name: 'issues',
                action: 'opened',
                delivery: 'd-1',
                installationId: 42,
                payload: JSON.parse(ISSUES_OPENED),
            } satisfies GithubEvent);
        }
    });

    it('dedupes a redelivery', async () => {
        const { app, store } = createGithubTestApp({ agents: standardAgents() });
        await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(response.status).toBe(202);
        const answer = await response.json() as Answer;
        expect(answer.runs.map((r) => r.deduplicated)).toEqual([true, true]);
        expect((await store.runs.find({})).total).toBe(2);
    });

    it('starts at most one run per agent', async () => {
        const { app, store } = createGithubTestApp({ agents: [agent('twice', { events: ['issues.opened'] }, { events: ['issues'] })] });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        const answer = await response.json() as Answer;
        expect(answer.runs).toHaveLength(1);
        const run = await store.runs.findOne(answer.runs[0]!.runId);
        expect(run?.trigger.trigger).toBe('github:issues.opened');
    });

    it('rejects a missing or wrong signature with 401', async () => {
        const { app, store } = createGithubTestApp({ agents: standardAgents() });
        const missing = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
            secret: null,
        });
        expect(missing.status).toBe(401);
        const wrong = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
            secret: 'not-the-secret',
        });
        expect(wrong.status).toBe(401);
        expect(await wrong.json()).toMatchObject({ status: 401, code: 'unauthorized' });
        expect((await store.runs.find({})).total).toBe(0);
    });

    it('checks the event and delivery headers', async () => {
        const { app, store } = createGithubTestApp({ agents: standardAgents() });
        const noEvent = await deliver(app, { delivery: 'd-1', body: ISSUES_OPENED });
        expect(noEvent.status).toBe(400);
        const badEvent = await deliver(app, {
            event: 'Issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(badEvent.status).toBe(400);
        const noDelivery = await deliver(app, { event: 'issues', body: ISSUES_OPENED });
        expect(noDelivery.status).toBe(400);
        const longDelivery = await deliver(app, {
            event: 'issues',
            delivery: 'd'.repeat(256),
            body: ISSUES_OPENED,
        });
        expect(longDelivery.status).toBe(400);
        expect((await store.runs.find({})).total).toBe(0);
    });

    it('answers 415 for a form-encoded delivery and 413 above bodyLimit', async () => {
        const { app } = createGithubTestApp({ agents: standardAgents(), channel: { bodyLimit: 64 } });
        const form = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: `payload=${encodeURIComponent('{"a":1}')}`,
            contentType: 'application/x-www-form-urlencoded',
        });
        expect(form.status).toBe(415);
        const large = await deliver(app, {
            event: 'issues',
            delivery: 'd-2',
            body: ISSUES_OPENED,
        });
        expect(large.status).toBe(413);
    });

    it('answers 400 for invalid JSON and for a JSON array', async () => {
        const { app } = createGithubTestApp({ agents: standardAgents() });
        const invalid = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: '{"action":',
        });
        expect(invalid.status).toBe(400);
        const array = await deliver(app, {
            event: 'issues',
            delivery: 'd-2',
            body: '[]',
        });
        expect(array.status).toBe(400);
    });

    it('acks ping and unmatched events without runs', async () => {
        const { app, store } = createGithubTestApp({ agents: standardAgents() });
        const ping = await deliver(app, {
            event: 'ping',
            delivery: 'd-1',
            body: '{"zen":"Design for failure.","hook_id":1}',
        });
        expect(ping.status).toBe(202);
        expect(await ping.json()).toEqual({ delivery: 'd-1', runs: [] });
        const release = await deliver(app, {
            event: 'release',
            delivery: 'd-2',
            body: '{"action":"published","installation":{"id":42}}',
        });
        expect(release.status).toBe(202);
        expect(await release.json()).toEqual({ delivery: 'd-2', runs: [] });
        expect((await store.runs.find({})).total).toBe(0);
    });

    it('dispatches an event name with digits (projects_v2_item)', async () => {
        const { app } = createGithubTestApp({ agents: [agent('board', { events: ['projects_v2_item.created'] })] });
        const response = await deliver(app, {
            event: 'projects_v2_item',
            delivery: 'd-1',
            body: JSON.stringify({ action: 'created', sender: { login: 'octocat', type: 'User' } }),
        });
        expect(response.status).toBe(202);
        expect((await response.json() as Answer).runs.map((r) => r.agent)).toEqual(['board']);
    });

    it('ignores events the App sent itself', async () => {
        const { app, fake } = createGithubTestApp({ agents: [agent('chat', { events: ['issue_comment'] })] });
        const first = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-1',
            body: BOT_COMMENT,
        });
        expect(first.status).toBe(202);
        expect((await first.json() as Answer).runs).toEqual([]);
        const second = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-2',
            body: BOT_COMMENT,
        });
        expect((await second.json() as Answer).runs).toEqual([]);
        expect(fake.requests.filter((r) => r.method === 'GET' && r.path === '/app')).toHaveLength(1);

        const dependabot = JSON.parse(BOT_COMMENT) as { sender: { login: string } };
        dependabot.sender.login = 'dependabot[bot]';
        const other = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-3',
            body: JSON.stringify(dependabot),
        });
        expect((await other.json() as Answer).runs).toHaveLength(1);
    });

    it('compares the sender with the bot login case-insensitively', async () => {
        const { app } = createGithubTestApp({ agents: [agent('chat', { events: ['issue_comment'] })], github: { slug: 'chamvi-test' } });
        const comment = JSON.parse(BOT_COMMENT) as { sender: { login: string } };
        comment.sender.login = 'Chamvi-Test[bot]';
        const response = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-1',
            body: JSON.stringify(comment),
        });
        expect((await response.json() as Answer).runs).toEqual([]);
    });

    it('answers 500 when the bot login cannot be read, and retries it on the next delivery', async () => {
        const {
            app, 
            fake, 
            errors, 
        } = createGithubTestApp({ agents: [agent('chat', { events: ['issue_comment'] })] });
        fake.failNext('GET', '/app', 500);
        const failed = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-1',
            body: BOT_COMMENT,
        });
        expect(failed.status).toBe(500);
        expect(errors).toHaveLength(1);
        const retried = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-1',
            body: BOT_COMMENT,
        });
        expect(retried.status).toBe(202);
        expect((await retried.json() as Answer).runs).toEqual([]);
    });

    it('uses the subscription\'s own keys', async () => {
        const { app, store } = createGithubTestApp({
            agents: [
                agent('keyed', {
                    events: ['issues.opened'],
                    idempotencyKey: (e) => `issue:${e.payload.issue?.number}`,
                    concurrencyKey: () => 'one-lane',
                }),
            ],
        });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        const answer = await response.json() as Answer;
        const run = await store.runs.findOne(answer.runs[0]!.runId);
        expect(run?.trigger.idempotencyKey).toBe('issue:5');
        expect(run?.trigger.concurrencyKey).toBe('one-lane');
    });

    it.each([
        ['a throwing filter', { filter: () => { throw new Error('unexpected payload'); } }],
        ['a throwing idempotencyKey', { idempotencyKey: () => { throw new Error('unexpected payload'); } }],
        ['a derived key above 255 characters', { idempotencyKey: () => 'k'.repeat(256) }],
        ['a derived concurrency key with NUL', { concurrencyKey: () => 'a\u0000b' }],
    ] as Array<[string, Partial<GithubSubscriptionOptions>]>)('dispatches the other agents past %s, reports it, then 500s', async (_name, broken) => {
        const {
            app,
            store,
            errors,
        } = createGithubTestApp({
            agents: [
                agent('broken', { events: ['issues'], ...broken }),
                agent('ok', { events: ['issues'] }),
            ],
        });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(response.status).toBe(500);
        expect(errors).toHaveLength(1);
        const { data } = await store.runs.find({});
        expect(data.map((r) => r.agent)).toEqual(['ok']);
    });

    it('a second channel serves its own subscriptions under its name', async () => {
        const { clock, gh } = createGithubFixture();
        const enterprise = githubChannel({
            app: gh, 
            name: 'github-ent', 
            clock, 
        });
        const store = createMemoryStore({ clock });
        const engine = new Engine({
            store,
            agents: [
                defineAgent({
                    name: 'ent',
                    model: textModel(),
                    instructions: 'ent',
                    channels: [enterprise.on('issues.opened')],
                }),
                defineAgent({
                    name: 'public',
                    model: textModel(),
                    instructions: 'public',
                    channels: [github.on('issues.opened')],
                }),
            ],
            channels: [enterprise, githubChannel({ app: gh, clock })],
            clock,
        });
        const app = createHttpApp({
            engine,
            auth: staticTokens({
                tokens: [{
                    value: 'admin-token-0123456789',
                    id: 'admin',
                    permissions: ['*'],
                }],
            }),
            metrics: false,
            rateLimit: false,
            channels: [enterprise],
        });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
            path: '/channels/github-ent',
        });
        expect(response.status).toBe(202);
        const answer = await response.json() as Answer;
        expect(answer.runs.map((r) => r.agent)).toEqual(['ent']);
        expect((await store.runs.findOne(answer.runs[0]!.runId))?.trigger.channel).toBe('github-ent');
        // the default channel is not served by this app
        const other = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(other.status).toBe(404);
    });

    it('answers 404 below the channel path', async () => {
        const { app, store } = createGithubTestApp({ agents: standardAgents() });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
            path: '/channels/github/triage',
        });
        expect(response.status).toBe(404);
        expect((await store.runs.find({})).total).toBe(0);
    });

    it('sets no address for an event without issue or pull request', async () => {
        const { app, store } = createGithubTestApp({ agents: [agent('pushes', { events: ['push'] })] });
        const response = await deliver(app, {
            event: 'push',
            delivery: 'd-1',
            body: JSON.stringify({ repository: { full_name: 'octo/demo' }, sender: { login: 'octocat', type: 'User' } }),
        });
        const answer = await response.json() as Answer;
        const run = await store.runs.findOne(answer.runs[0]!.runId);
        expect(run?.trigger.address).toBeUndefined();
        expect(run?.trigger.concurrencyKey).toBe('octo/demo');
    });

    it('a failing dispatch still dispatches the other agents, then 500s', async () => {
        const agents = [
            agent('first', { events: ['issues'] }),
            agent('second', { events: ['issues'] }),
            agent('third', { events: ['issues'] }),
        ];
        const broken = createGithubTestApp({ agents });
        const dispatch = broken.engine.dispatch.bind(broken.engine);
        broken.engine.dispatch = async (envelope) => {
            if (envelope.agent === 'second') throw new Error('second is down');
            return dispatch(envelope);
        };
        const failed = await deliver(broken.app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(failed.status).toBe(500);
        expect(await failed.json()).toMatchObject({ status: 500, message: 'Internal Server Error' });
        expect(broken.errors).toHaveLength(1);
        const { data } = await broken.store.runs.find({});
        expect(data.map((r) => r.agent).sort()).toEqual(['first', 'third']);
    });

    it('dedupes the agents that succeeded when a failed delivery is redelivered', async () => {
        const agents = [
            agent('first', { events: ['issues'] }),
            agent('second', { events: ['issues'] }),
            agent('third', { events: ['issues'] }),
        ];
        let engineKnowsSecond = false;
        const setup = createGithubTestApp({ agents });
        // the engine refuses `second` until it is "fixed"
        const dispatch = setup.engine.dispatch.bind(setup.engine);
        setup.engine.dispatch = async (envelope) => {
            if (envelope.agent === 'second' && !engineKnowsSecond) throw new Error('second is down');
            return dispatch(envelope);
        };
        const failed = await deliver(setup.app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(failed.status).toBe(500);
        engineKnowsSecond = true;
        const redelivered = await deliver(setup.app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(redelivered.status).toBe(202);
        const answer = await redelivered.json() as Answer;
        expect(answer.runs.map((r) => [r.agent, r.deduplicated])).toEqual([
            ['first', true],
            ['second', false],
            ['third', true],
        ]);
    });
});
