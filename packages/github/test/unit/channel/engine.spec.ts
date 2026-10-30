/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    ToolDeniedError,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { ChamviError, Engine } from '@chamvi/core';
import { github } from '@chamvi/github';
import type { GithubChannelOptions, IGithubApp } from '@chamvi/github';
import { createGithubTestApp, deliver } from '../../utils/app.ts';
import type { GithubTestApp } from '../../utils/app.ts';
import { mockModel } from '../../utils/model.ts';
import type { MockResponse } from '../../utils/model.ts';

const ISSUES_OPENED = readFileSync(new URL('../../fixtures/deliveries/issues-opened.json', import.meta.url), 'utf8');
const ISSUE = { repo: 'octo/demo', number: 5 };
const APPROVAL_URL: GithubChannelOptions['approvalUrl'] = (ref) => `https://chamvi.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}&agent=${ref.agent}`;

const engines: Engine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.drain()));
    engines.length = 0;
});

const reply = defineTool({
    description: 'Answers on the issue the run came from.',
    inputSchema: z.object({ body: z.string() }),
    execute: async ({ body }, { context }) => {
        await context.channels.findOneOrFail().emit({ body });

        return 'sent';
    },
});

function replyAgent(script: MockResponse[]) {
    return () => [defineAgent({
        name: 'triage',
        model: mockModel(script),
        instructions: 'Answer on the issue.',
        channels: [github.on('issues.opened')],
        tools: { reply },
    })];
}

/** Closing an issue waits for the owner, asked on the issue itself. */
function closeAgent(gh: IGithubApp) {
    return [defineAgent({
        name: 'triage',
        model: mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'github_close_issue',
                    input: { ...ISSUE, reason: 'not_planned' },
                }],
            },
            { parts: [{ type: 'text', text: 'Closed.' }] },
        ]),
        instructions: 'Close duplicates.',
        channels: [github.on('issues.opened')],
        tools: () => gh.writeTools(),
        hooks: {
            async beforeToolExecution(call, ctx) {
                if (call.toolName !== 'github_close_issue') {
                    return undefined;
                }

                const decision = await ctx.channels.findOneOrFail('github').approve({
                    title: 'Close octo/demo#5?',
                    body: 'It duplicates #3.',
                });

                if (!decision.approved) {
                    throw new ToolDeniedError('The owner keeps the issue open.');
                }

                return undefined;
            },
        },
    })];
}

async function start(setup: GithubTestApp): Promise<string> {
    engines.push(setup.engine);

    const { issue } = (JSON.parse(ISSUES_OPENED) as { issue: Record<string, unknown> });

    setup.fake.issues.set('octo/demo#5', { ...issue });

    const response = await deliver(setup.app, {
        event: 'issues',
        delivery: 'd-1',
        body: ISSUES_OPENED,
    });

    expect(response.status).toBe(202);

    const { runs } = await response.json() as { runs: Array<{ runId: string }> };

    await setup.engine.start();
    await setup.engine.idle();

    return runs[0]!.runId;
}

describe('github channel with the engine', () => {
    it('ctx.channels.findOne() in a github run comments on the source issue', async () => {
        const setup = createGithubTestApp({
            agents: replyAgent([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'reply',
                        input: { body: 'Done.' },
                    }],
                },
                // the same text again in a later step: content-addressed, so not posted twice
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'reply',
                        input: { body: 'Done.' },
                    }],
                },
                { parts: [{ type: 'text', text: 'Answered.' }] },
            ]),
        });
        const runId = await start(setup);

        expect((await setup.engine.getRun(runId))?.status).toBe('completed');

        const comments = setup.fake.comments.get('octo/demo#5') ?? [];

        expect(comments).toHaveLength(1);
        expect(String(comments[0]!.body)).toContain('Done.');
        expect(String(comments[0]!.body)).toContain(`<!-- chamvi:effect=${runId}:emit:github:`);
        expect(setup.errors).toEqual([]);
    });

    it('an approval for a github run posts one comment with the approval link and no token', async () => {
        const setup = createGithubTestApp({ agents: closeAgent, channel: { approvalUrl: APPROVAL_URL } });
        const runId = await start(setup);

        const waiting = (await setup.engine.getRun(runId))!;

        expect(waiting.status).toBe('waiting');
        expect(waiting.waiting).toMatchObject({
            toolName: 'github_close_issue',
            channel: 'github',
            address: 'octo/demo#5',
        });
        expect(waiting.waiting?.notifiedAt).toBeInstanceOf(Date);

        const comments = () => setup.fake.comments.get('octo/demo#5') ?? [];

        expect(comments()).toHaveLength(1);

        const body = String(comments()[0]!.body);

        expect(body).toContain('### Close octo/demo#\u200D5?');
        expect(body).toContain('It duplicates #3.');
        expect(body).toContain(`Approve or deny: https://chamvi.example/ui/approvals?run=${runId}&approval=${waiting.waiting!.approvalId}&agent=triage`);
        expect(setup.fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);

        await setup.engine.tick();
        await setup.engine.tick();
        expect(comments()).toHaveLength(1);

        await setup.engine.approve(runId, { approvalId: waiting.waiting!.approvalId, approved: true });
        await setup.engine.idle();
        expect((await setup.engine.getRun(runId))?.status).toBe('completed');
        expect(setup.fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
        expect(comments()).toHaveLength(1);
        expect(setup.errors).toEqual([]);
    });

    it('reconciles a lost response', async () => {
        const setup = createGithubTestApp({ agents: closeAgent });
        let lost = false;

        setup.fake.route('POST', '/repos/:owner/:repo/issues/:number/comments', ({ params, body }) => {
            const key = `${params.owner}/${params.repo}#${params.number}`;

            setup.fake.comments.set(key, [...(setup.fake.comments.get(key) ?? []), {
                id: 1,
                body: (body as { body: string }).body,
                user: { login: 'chamvi-test[bot]', type: 'Bot' },
                created_at: '2026-10-20T10:00:00.000Z',
                updated_at: '2026-10-20T10:00:00.000Z',
            }]);

            if (lost) {
                return { status: 201, body: { id: 1 } };
            }

            lost = true;

            return { status: 502, body: { message: 'Bad Gateway' } };
        });

        const runId = await start(setup);

        expect(setup.errors).toHaveLength(1);
        expect((setup.errors[0] as ChamviError).code).toBe('github_request');
        expect(setup.fake.comments.get('octo/demo#5')).toHaveLength(1);
        expect((await setup.engine.getRun(runId))?.waiting?.notifiedAt).toBeUndefined();

        await setup.engine.tick();
        expect(setup.fake.comments.get('octo/demo#5')).toHaveLength(1);
        expect((await setup.engine.getRun(runId))?.waiting?.notifiedAt).toBeInstanceOf(Date);
    });
});
