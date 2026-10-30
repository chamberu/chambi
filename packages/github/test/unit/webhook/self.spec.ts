/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import type { Agent } from '@chamvi/core';
import { github } from '@chamvi/github';
import type { GithubSubscriptionOptions } from '@chamvi/github';
import { createGithubTestApp, deliver } from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

const BOT = {
    login: 'chamvi-test[bot]',
    id: 6001,
    type: 'Bot',
};

function agent(name: string, events: string[], options: GithubSubscriptionOptions = {}): Agent {
    return defineAgent({
        name,
        model: textModel(),
        instructions: name,
        channels: [github.on(events, options)],
    });
}

function body(action: string, sender: Record<string, unknown> = BOT, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        action,
        repository: { full_name: 'octo/demo' },
        installation: { id: 42 },
        sender,
        ...extra,
    });
}

async function agentsOf(response: Response): Promise<string[]> {
    expect(response.status).toBe(202);

    const answer = await response.json() as { runs: Array<{ agent: string }> };

    return answer.runs.map((run) => run.agent);
}

describe('the bot\'s own deliveries', () => {
    it('dispatch nothing without selfEvents', async () => {
        const { app } = createGithubTestApp({ agents: [agent('maintainer', ['pull_request'])] });
        const response = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-1',
            body: body('synchronize', BOT, { pull_request: { number: 3 } }),
        });

        expect(await agentsOf(response)).toEqual([]);
    });

    it('dispatch to a subscription that opts in only', async () => {
        const { app } = createGithubTestApp({
            agents: [
                agent('maintainer', ['pull_request', 'check_suite'], { selfEvents: ['pull_request', 'check_suite.completed'] }),
                agent('other', ['pull_request']),
            ],
        });
        const synchronize = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-1',
            body: body('synchronize', BOT, { pull_request: { number: 3 } }),
        });

        expect(await agentsOf(synchronize)).toEqual(['maintainer']);

        const completed = await deliver(app, {
            event: 'check_suite',
            delivery: 'd-2',
            body: body('completed'),
        });

        expect(await agentsOf(completed)).toEqual(['maintainer']);

        const requested = await deliver(app, {
            event: 'check_suite',
            delivery: 'd-3',
            body: body('requested'),
        });

        expect(await agentsOf(requested)).toEqual([]);
    });

    it('still dispatch a human delivery to every subscription', async () => {
        const { app } = createGithubTestApp({
            agents: [
                agent('maintainer', ['pull_request'], { selfEvents: ['pull_request'] }),
                agent('other', ['pull_request']),
            ],
        });
        const response = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-1',
            body: body('opened', { login: 'alice', type: 'User' }, { pull_request: { number: 3 } }),
        });

        expect(await agentsOf(response)).toEqual(['maintainer', 'other']);
    });

    it('dispatch to a later subscription that opts in when the first does not', async () => {
        const { app, engine } = createGithubTestApp({
            agents: [defineAgent({
                name: 'maintainer',
                model: textModel(),
                instructions: 'maintainer',
                channels: [
                    github.on(['pull_request'], { id: 'humans' }),
                    github.on(['pull_request'], { id: 'self', selfEvents: ['pull_request.opened'] }),
                ],
            })],
        });
        const bot = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-1',
            body: body('opened', BOT, { pull_request: { number: 3 } }),
        });

        expect(bot.status).toBe(202);

        const { runs: [botRun] } = await bot.json() as { runs: Array<{ runId: string }> };

        expect((await engine.getRun(botRun!.runId))?.trigger.trigger).toBe('self');

        const human = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-2',
            body: body('opened', { login: 'alice', type: 'User' }, { pull_request: { number: 4 } }),
        });
        const { runs: [humanRun] } = await human.json() as { runs: Array<{ runId: string }> };

        expect((await engine.getRun(humanRun!.runId))?.trigger.trigger).toBe('humans');
    });

    it('never run a self subscription filter for a human delivery', async () => {
        const {
            app,
            engine,
            errors,
        } = createGithubTestApp({
            agents: [defineAgent({
                name: 'maintainer',
                model: textModel(),
                instructions: 'maintainer',
                channels: [
                    github.on(['pull_request'], { id: 'humans' }),
                    github.on(['pull_request'], {
                        id: 'self',
                        selfEvents: ['pull_request.opened'],
                        filter: () => {
                            throw new Error('self filter');
                        },
                    }),
                ],
            })],
        });
        const human = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-1',
            body: body('opened', { login: 'alice', type: 'User' }, { pull_request: { number: 4 } }),
        });

        expect(human.status).toBe(202);

        const { runs: [humanRun] } = await human.json() as { runs: Array<{ runId: string }> };

        expect((await engine.getRun(humanRun!.runId))?.trigger.trigger).toBe('humans');
        expect(errors).toEqual([]);
    });

    it('never dispatch a bot-sent action the selfEvents do not name', async () => {
        const { app } = createGithubTestApp({ agents: [agent('maintainer', ['pull_request'], { selfEvents: ['pull_request.opened', 'pull_request.synchronize'] })] });
        const labeled = await deliver(app, {
            event: 'pull_request',
            delivery: 'd-1',
            body: body('labeled', BOT, { pull_request: { number: 3 } }),
        });

        expect(await agentsOf(labeled)).toEqual([]);
    });

    it('never dispatch a bot-sent issue_comment', async () => {
        const { app } = createGithubTestApp({ agents: [agent('maintainer', ['issue_comment', 'pull_request'], { selfEvents: ['pull_request'] })] });
        const response = await deliver(app, {
            event: 'issue_comment',
            delivery: 'd-1',
            body: body('created', BOT, { issue: { number: 3 }, comment: { body: 'hi' } }),
        });

        expect(await agentsOf(response)).toEqual([]);
    });

    it.each(['issue_comment', 'issues.opened', 'pull_request_review_comment'])('refuses selfEvents naming %s', (event) => {
        expect(() => github.on(['issue_comment'], { selfEvents: [event] })).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a malformed selfEvents entry', () => {
        expect(() => github.on(['pull_request'], { selfEvents: ['Pull Request'] })).toThrow(InvalidAgentDefinitionError);
        expect(() => github.on(['pull_request'], { selfEvents: 'pull_request' as never })).toThrow(InvalidAgentDefinitionError);
    });
});
