/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ModelMessage, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { MemoryStore, effectMarker, wrapToolsForRun } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { START, createGithubFixture } from '../../utils/app.ts';
import { assistant, callTool, toolContext } from '../../utils/tools.ts';

const USER: ModelMessage = { role: 'user', content: 'An issue was opened.' };
const STEP_1: ModelMessage[] = [USER, assistant()];

function setup() {
    const fixture = createGithubFixture();
    fixture.fake.issues.set('octo/demo#5', {
        number: 5,
        title: 'Crash',
        state: 'open',
        state_reason: null,
        labels: [],
    });
    const ctx = toolContext();
    const wrap = (store = new MemoryStore()): ToolSet => wrapToolsForRun(fixture.gh.writeTools(), ctx, store);
    return {
        ...fixture,
        ctx,
        wrap,
    };
}

function comment(tools: ToolSet, ctx: ToolContext, body: string, messages: ModelMessage[], toolCallId = 'call-1') {
    return callTool<{ id: number; url: string }>(tools, 'github_create_comment', {
        repo: 'octo/demo',
        number: 5,
        body,
    }, ctx, { messages, toolCallId });
}

const posts = (fake: ReturnType<typeof setup>['fake']) => fake.requests.filter(
    (r) => r.method === 'POST' && r.path === '/repos/octo/demo/issues/5/comments',
);

describe('write tools', () => {
    it('offers the write tools only', () => {
        const { gh } = createGithubFixture();
        expect(Object.keys(gh.writeTools()).sort()).toEqual([
            'github_add_labels',
            'github_close_issue',
            'github_create_comment',
            'github_create_issue',
            'github_create_pull_request',
        ]);
    });

    it('create_comment embeds the marker', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const result = await comment(wrap(), ctx, 'Thanks!', STEP_1);
        const marker = effectMarker('run-1:github_create_comment:octo/demo#5:1');
        expect(marker).toBe('<!-- chamvi:effect=run-1:github_create_comment:octo/demo#5:1 -->');
        expect((posts(fake)[0]?.body as { body: string }).body).toBe(`Thanks!\n\n${marker}`);
        expect(result).toEqual({
            id: 9000,
            url: 'https://github.com/octo/demo/issues/5#issuecomment-9000',
        });
    });

    it('finds its own comment after a lost effect record and does not repost', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const first = await comment(wrap(), ctx, 'Labelled as a bug.', STEP_1);
        // a recovery redoes the step: a fresh effect store and a regenerated body
        const second = await comment(wrap(), ctx, 'This looks like a bug, labelled.', STEP_1);
        expect(posts(fake)).toHaveLength(1);
        expect(second).toEqual(first);
    });

    it('ignores a marker in another author\'s comment', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        fake.comments.set('octo/demo#5', [{
            id: 1,
            body: `copied ${effectMarker('run-1:github_create_comment:octo/demo#5:1')}`,
            html_url: 'https://github.com/octo/demo/issues/5#issuecomment-1',
            user: { login: 'mallory', type: 'User' },
            created_at: START.toISOString(),
            updated_at: START.toISOString(),
        }]);
        const result = await comment(wrap(), ctx, 'Thanks!', STEP_1);
        expect(posts(fake)).toHaveLength(1);
        expect(result.id).not.toBe(1);
    });

    it('a later step posts again', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const tools = wrap();
        await comment(tools, ctx, 'First.', STEP_1);
        await comment(tools, ctx, 'Second.', [...STEP_1, assistant()]);
        const bodies = posts(fake).map((r) => (r.body as { body: string }).body);
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).toContain('octo/demo#5:2 -->');
    });

    it('an approved comment keeps its step', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const tools = wrap();
        // the approval path: the messages already hold the requesting assistant message
        await comment(tools, ctx, 'Approved.', [...STEP_1, assistant('c-7')], 'c-7');
        expect((posts(fake)[0]?.body as { body: string }).body).toContain('octo/demo#5:1 -->');
        // the following step comments again
        await comment(tools, ctx, 'Next.', [...STEP_1, assistant('c-7'), { role: 'user', content: 'go on' }], 'c-9');
        expect(posts(fake)).toHaveLength(2);
        expect((posts(fake)[1]?.body as { body: string }).body).toContain('octo/demo#5:2 -->');
    });

    it('a second call for the same issue in one step returns the first comment', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const tools = wrap();
        const first = await comment(tools, ctx, 'One.', STEP_1, 'call-1');
        const second = await comment(tools, ctx, 'Two.', STEP_1, 'call-2');
        expect(posts(fake)).toHaveLength(1);
        expect(second).toEqual(first);
    });

    it('keys the comment by the repository regardless of its casing', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const tools = wrap();
        const first = await comment(tools, ctx, 'One.', STEP_1, 'call-1');
        const second = await callTool<{ id: number; url: string }>(tools, 'github_create_comment', {
            repo: 'Octo/Demo',
            number: 5,
            body: 'Two.',
        }, ctx, { messages: STEP_1, toolCallId: 'call-2' });
        expect(second).toEqual(first);
        expect(fake.requests.filter((r) => r.method === 'POST' && r.path.toLowerCase() === '/repos/octo/demo/issues/5/comments')).toHaveLength(1);
        expect((posts(fake)[0]?.body as { body: string }).body).toContain(':github_create_comment:octo/demo#5:1 -->');
    });

    it('bounds the reconciliation', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        await comment(wrap(), ctx, 'Thanks!', STEP_1);
        const list = fake.requests.find((r) => r.method === 'GET' && r.path === '/repos/octo/demo/issues/5/comments');
        expect(list?.query).toMatchObject({
            since: new Date(START.getTime() - 3_600_000).toISOString(),
            per_page: '100',
        });
    });

    it('add_labels sends the labels and records the effect', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const tools = wrap();
        const input = {
            repo: 'octo/demo', 
            number: 5, 
            labels: ['bug', 'p1'], 
        };
        expect(await callTool(tools, 'github_add_labels', input, ctx)).toEqual({ labels: ['bug', 'p1'] });
        expect(await callTool(tools, 'github_add_labels', input, ctx)).toEqual({ labels: ['bug', 'p1'] });
        const sent = fake.requests.filter((r) => r.method === 'POST' && r.path === '/repos/octo/demo/issues/5/labels');
        expect(sent).toHaveLength(1);
        expect(sent[0]?.body).toEqual({ labels: ['bug', 'p1'] });
    });

    it('close_issue patches once', async () => {
        const {
            fake,
            ctx,
            wrap,
        } = setup();
        const result = await callTool(wrap(), 'github_close_issue', {
            repo: 'octo/demo', 
            number: 5, 
            reason: 'not_planned', 
        }, ctx);
        expect(result).toEqual({
            number: 5, 
            state: 'closed', 
            stateReason: 'not_planned', 
        });
        const patches = fake.requests.filter((r) => r.method === 'PATCH');
        expect(patches).toHaveLength(1);
        expect(patches[0]?.body).toEqual({ state: 'closed', state_reason: 'not_planned' });

        // a lost record: the issue is already closed, nothing is patched again
        const again = await callTool(wrap(), 'github_close_issue', {
            repo: 'octo/demo', 
            number: 5, 
            reason: 'not_planned', 
        }, ctx);
        expect(again).toEqual(result);
        expect(fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    });

    it('rejects bad input as tool errors', async () => {
        const { ctx, wrap } = setup();
        const tools = wrap();
        await expect(callTool(tools, 'github_add_labels', {
            repo: 'octo/demo', 
            number: 5, 
            labels: [], 
        }, ctx)).rejects.toThrow(/labels/);
        await expect(callTool(tools, 'github_create_comment', {
            repo: 'octo/demo', 
            number: 5, 
            body: '', 
        }, ctx)).rejects.toThrow(/body/);
        await expect(callTool(tools, 'github_close_issue', {
            repo: 'octo/demo', 
            number: 5, 
            reason: 'duplicate', 
        }, ctx)).rejects.toThrow(/reason/);
    });

    describe('github_create_issue', () => {
        function cron() {
            const fixture = createGithubFixture();
            const ctx = toolContext({ channel: 'cron' });
            fixture.fake.installations.set('tada5hi/agents-dev', 77);
            const wrap = (store = new MemoryStore()): ToolSet => wrapToolsForRun(fixture.gh.writeTools(), ctx, store);
            const create = (tools: ToolSet) => callTool<{ number: number; url: string }>(tools, 'github_create_issue', {
                repo: 'tada5hi/agents-dev',
                title: 'Daily digest',
                body: 'Open issues: 3',
                labels: ['report'],
            }, ctx);
            return {
                ...fixture, 
                ctx, 
                wrap, 
                create, 
            };
        }
        const issuePosts = (fake: ReturnType<typeof setup>['fake']) => fake.requests.filter((r) => r.method === 'POST' && r.path === '/repos/tada5hi/agents-dev/issues');

        it('embeds the marker and acts as the repository installation', async () => {
            const {
                fake, 
                wrap, 
                create, 
            } = cron();
            const result = await create(wrap());
            expect(result).toEqual({ number: 1, url: 'https://github.com/tada5hi/agents-dev/issues/1' });
            const body = issuePosts(fake)[0]!.body as {
                title: string; 
                body: string; 
                labels: string[] 
            };
            expect(body).toMatchObject({ title: 'Daily digest', labels: ['report'] });
            expect(body.body).toMatch(/^Open issues: 3\n\n<!-- chamvi:effect=run-1:github_create_issue:[0-9a-f]{64} -->$/);
            expect(fake.tokenInstallations).toEqual([77]);
        });

        it('finds its issue after a lost record', async () => {
            const {
                fake, 
                wrap, 
                create, 
            } = cron();
            const first = await create(wrap());
            const second = await create(wrap());
            expect(second).toEqual(first);
            expect(issuePosts(fake)).toHaveLength(1);
            const list = fake.requests.find((r) => r.method === 'GET' && r.path === '/repos/tada5hi/agents-dev/issues');
            expect(list?.query).toMatchObject({
                state: 'all', 
                creator: 'chamvi-test[bot]', 
                since: new Date(START.getTime() - 3_600_000).toISOString(), 
            });
        });

        it('refuses a missing title', async () => {
            const { wrap, ctx } = cron();
            await expect(callTool(wrap(), 'github_create_issue', {
                repo: 'tada5hi/agents-dev', 
                title: '', 
                body: 'x', 
            }, ctx)).rejects.toMatchObject({ code: 'validation_error' });
        });
    });
});
