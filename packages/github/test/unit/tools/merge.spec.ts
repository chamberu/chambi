/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    InvalidAgentDefinitionError,
    MemoryStore,
    ValidationError,
    wrapToolsForRun,
} from '@chamvi/core';
import type { ToolSet } from 'ai';
import type { GithubCreatedPullRequest, GithubWriteToolsOptions } from '@chamvi/github';
import { createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';

function setup(options?: GithubWriteToolsOptions) {
    const fixture = createGithubFixture();
    const ctx = toolContext({ channel: 'cron' });
    fixture.fake.installations.set('octo/demo', 9);
    const wrap = (store = new MemoryStore()): ToolSet => wrapToolsForRun(fixture.gh.writeTools(options), ctx, store);
    const call = <T = unknown>(tools: ToolSet, name: string, input: unknown) => callTool<T>(tools, name, input, ctx);
    const pullPosts = () => fixture.fake.requests.filter((r) => r.method === 'POST' && r.path === '/repos/octo/demo/pulls');
    return {
        ...fixture, 
        ctx, 
        wrap, 
        call, 
        pullPosts, 
    };
}

describe('github_create_pull_request', () => {
    const INPUT = {
        repo: 'octo/demo', 
        head: 'chamvi/fix-ci', 
        title: 'Fix CI', 
        body: 'The lint step failed.', 
    };

    it('defaults base to the default branch', async () => {
        const {
            fake, 
            wrap, 
            call, 
            pullPosts, 
        } = setup();
        fake.repositories.set('octo/demo', { full_name: 'octo/demo', default_branch: 'develop' });
        const result = await call<GithubCreatedPullRequest>(wrap(), 'github_create_pull_request', INPUT);
        expect(result).toEqual({
            number: 1, 
            url: 'https://github.com/octo/demo/pull/1', 
            base: 'develop', 
            head: 'octo:chamvi/fix-ci', 
        });
        const body = pullPosts()[0]!.body as Record<string, unknown>;
        expect(body).toMatchObject({
            head: 'chamvi/fix-ci', 
            base: 'develop', 
            title: 'Fix CI', 
            draft: false, 
        });
        expect(body.body).toMatch(/^The lint step failed\.\n\n<!-- chamvi:effect=run-1:github_create_pull_request:[0-9a-f]{64} -->$/);
        expect(fake.tokenInstallations).toEqual([9]);
    });

    it('takes a base and owner:branch for a fork', async () => {
        const {
            wrap, 
            call, 
            pullPosts, 
        } = setup();
        const result = await call<GithubCreatedPullRequest>(wrap(), 'github_create_pull_request', {
            ...INPUT, 
            head: 'someone:patch', 
            base: 'main', 
            draft: true, 
        });
        expect(result).toMatchObject({ base: 'main', head: 'someone:patch' });
        expect(pullPosts()[0]!.body).toMatchObject({
            head: 'someone:patch', 
            base: 'main', 
            draft: true, 
        });
    });

    it('finds its pull after a lost record', async () => {
        const {
            fake, 
            wrap, 
            call, 
            pullPosts, 
        } = setup();
        const first = await call(wrap(), 'github_create_pull_request', INPUT);
        const second = await call(wrap(), 'github_create_pull_request', INPUT);
        expect(second).toEqual(first);
        expect(pullPosts()).toHaveLength(1);
        expect(fake.requests.find((r) => r.method === 'GET' && r.path === '/repos/octo/demo/pulls')?.query).toMatchObject({ state: 'all', head: 'octo:chamvi/fix-ci' });
    });

    it('refuses a head outside HEAD_PATTERN', async () => {
        const { wrap, call } = setup();
        for (const head of ['a b', 'x:y:z', '']) {
            await expect(call(wrap(), 'github_create_pull_request', { ...INPUT, head })).rejects.toBeInstanceOf(ValidationError);
        }
        await expect(call(wrap(), 'github_create_pull_request', { ...INPUT, base: 'a..b' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('passes GitHub\'s 422 as a tool error', async () => {
        const {
            fake, 
            wrap, 
            call, 
        } = setup();
        fake.pulls.set('octo/demo#3', {
            number: 3, 
            state: 'open', 
            head: { ref: 'chamvi/fix-ci', label: 'octo:chamvi/fix-ci' }, 
            base: { ref: 'main' }, 
        });
        await expect(call(wrap(), 'github_create_pull_request', { ...INPUT, base: 'main' })).rejects.toMatchObject({ code: 'github_request', message: expect.stringContaining('422') });
    });
});

describe('writeTools options', () => {
    it('refuses an unknown merge method', () => {
        const { gh } = createGithubFixture();
        expect(() => gh.writeTools({ mergeMethod: 'fast-forward' as never })).toThrow(InvalidAgentDefinitionError);
    });
});
