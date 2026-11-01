/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    InvalidAgentDefinitionError,
    ToolDeniedError,
    ValidationError,
    createMemoryStore,
    wrapToolsForRun,
} from '@chamvi/core';
import type { ToolSet } from 'ai';
import type { GithubCreatedPullRequest, GithubMergeResult, GithubWriteToolsOptions } from '@chamvi/github';
import { createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';

function setup(options?: GithubWriteToolsOptions) {
    const fixture = createGithubFixture();
    const ctx = toolContext({ channel: 'cron' });

    fixture.fake.installations.set('octo/demo', 9);

    const wrap = (store = createMemoryStore()): ToolSet => wrapToolsForRun(fixture.gh.writeTools(options), ctx, store.effects);
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

    it('matches only a marker in the pull body\'s final footer', async () => {
        const {
            fake,
            wrap,
            call,
            pullPosts,
        } = setup();

        await call(wrap(), 'github_create_pull_request', INPUT);

        const pull = fake.pulls.get('octo/demo#1')!;

        pull.body = `${String(pull.body)}\n\nQuoted footer, then edited.`;
        pull.state = 'closed';
        await call(wrap(), 'github_create_pull_request', INPUT);
        expect(pullPosts()).toHaveLength(2);
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

describe('github_merge_pull_request', () => {
    function mergeable(options?: GithubWriteToolsOptions, patch: Record<string, unknown> = {}) {
        const fixture = setup(options);

        fixture.fake.pulls.set('octo/demo#3', {
            number: 3,
            title: 'Bump lodash',
            state: 'open',
            draft: false,
            merged: false,
            mergeable: true,
            mergeable_state: 'clean',
            head: {
                ref: 'deps',
                label: 'octo:deps',
                sha: 'abc',
                repo: { full_name: 'octo/demo' },
            },
            base: { ref: 'main', repo: { full_name: 'octo/demo' } },
            ...patch,
        });
        fixture.fake.checkRuns.set('octo/demo@abc', [{
            name: 'test',
            status: 'completed',
            conclusion: 'success',
        }]);

        const merges = () => fixture.fake.requests.filter((r) => r.method === 'PUT' && r.path === '/repos/octo/demo/pulls/3/merge');
        const merge = (input: Record<string, unknown> = {}, tools = fixture.wrap()) => fixture.call<GithubMergeResult>(tools, 'github_merge_pull_request', {
            repo: 'octo/demo',
            number: 3,
            sha: 'abc',
            ...input,
        });
        const requireTest = () => fixture.fake.branches.set('octo/demo:main', {
            name: 'main',
            protected: true,
            protection: { enabled: true, required_status_checks: { contexts: ['test'], checks: [] } },
        });

        return {
            ...fixture,
            merges,
            merge,
            requireTest,
        };
    }

    async function denied(promise: Promise<unknown>): Promise<string> {
        const error = await promise.then(() => undefined, (e: unknown) => e);

        expect(error).toBeInstanceOf(ToolDeniedError);

        return (error as Error).message;
    }

    it('merges at the given sha with the default squash', async () => {
        const {
            fake,
            merge,
            merges,
        } = mergeable();

        expect(await merge()).toEqual({
            number: 3,
            sha: 'merge-3',
            method: 'squash',
            alreadyMerged: false,
        });
        expect(merges()[0]!.body).toEqual({ sha: 'abc', merge_method: 'squash' });
        expect(fake.pulls.get('octo/demo#3')).toMatchObject({ merged: true, merge_method: 'squash' });
        expect(fake.tokenInstallations).toEqual([9]);
    });

    it('takes the method from writeTools options and the input', async () => {
        const options = mergeable({ mergeMethod: 'rebase' });

        expect(await options.merge()).toMatchObject({ method: 'rebase' });

        const input = mergeable({ mergeMethod: 'rebase' });

        expect(await input.merge({
            method: 'merge',
            commitTitle: 'Bump lodash (#3)',
            commitMessage: 'Patch.',
        })).toMatchObject({ method: 'merge' });
        expect(input.merges()[0]!.body).toEqual({
            sha: 'abc',
            merge_method: 'merge',
            commit_title: 'Bump lodash (#3)',
            commit_message: 'Patch.',
        });
        await expect(input.merge({ method: 'octopus' })).rejects.toBeInstanceOf(ValidationError);
        await expect(input.merge({ sha: 'not a sha' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses when the head moved', async () => {
        const { merge, merges } = mergeable();

        expect(await denied(merge({ sha: 'old' }))).toBe('The head of #3 moved to abc; read its checks again.');
        expect(merges()).toEqual([]);
    });

    it('refuses a closed pull request', async () => {
        const { merge, merges } = mergeable(undefined, { state: 'closed' });

        expect(await denied(merge())).toBe('Pull request #3 is closed.');
        expect(merges()).toEqual([]);
    });

    it('refuses a pull request merged at another head', async () => {
        const { merge } = mergeable(undefined, {
            state: 'closed',
            merged: true,
            merge_commit_sha: 'm',
        });

        expect(await denied(merge({ sha: 'old' }))).toBe('Pull request #3 is merged.');
    });

    it('answers an already merged pull request at the sha', async () => {
        const { merge, merges } = mergeable(undefined, {
            state: 'closed',
            merged: true,
            merge_commit_sha: 'm',
        });

        expect(await merge()).toEqual({
            number: 3,
            sha: 'm',
            method: 'squash',
            alreadyMerged: true,
        });
        expect(merges()).toEqual([]);
    });

    it('refuses a draft', async () => {
        const { merge, merges } = mergeable(undefined, { draft: true });

        expect(await denied(merge())).toBe('#3 is a draft.');
        expect(merges()).toEqual([]);
    });

    it('refuses while mergeability is unknown', async () => {
        const { merge, merges } = mergeable(undefined, { mergeable: null });

        expect(await denied(merge())).toBe('GitHub is still computing whether #3 can merge; read it again in a minute.');
        expect(merges()).toEqual([]);
    });

    it.each(['dirty', 'blocked', 'behind', 'draft', 'unknown'])('refuses mergeable_state %s', async (state) => {
        const { merge, merges } = mergeable(undefined, { mergeable_state: state });

        expect(await denied(merge())).toBe(`#3 cannot merge: mergeable_state is ${state}.`);
        expect(merges()).toEqual([]);
    });

    it('refuses mergeable false', async () => {
        const { merge } = mergeable(undefined, { mergeable: false, mergeable_state: 'clean' });

        expect(await denied(merge())).toBe('#3 cannot merge: mergeable_state is clean.');
    });

    it('allows unstable when every required check is green', async () => {
        const {
            fake,
            merge,
            requireTest,
        } = mergeable(undefined, { mergeable_state: 'unstable' });

        requireTest();
        fake.checkRuns.set('octo/demo@abc', [
            {
                name: 'test',
                status: 'completed',
                conclusion: 'success',
            },
            {
                name: 'flaky',
                status: 'completed',
                conclusion: 'failure',
            },
        ]);
        expect(await merge()).toMatchObject({ alreadyMerged: false });
    });

    it('refuses a clean state with a failing required check', async () => {
        const {
            fake,
            merge,
            merges,
            requireTest,
        } = mergeable();

        requireTest();
        fake.checkRuns.set('octo/demo@abc', [{
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
        }]);
        expect(await denied(merge())).toBe('#3 has required checks that are not green: test.');
        expect(merges()).toEqual([]);
    });

    it('refuses while a required check is missing', async () => {
        const {
            fake,
            merge,
            merges,
            requireTest,
        } = mergeable();

        requireTest();
        fake.checkRuns.set('octo/demo@abc', []);
        expect(await denied(merge())).toBe('#3 has required checks that are not green: test.');
        expect(merges()).toEqual([]);
    });

    it('refuses while a required check is pending', async () => {
        const {
            fake,
            merge,
            requireTest,
        } = mergeable();

        requireTest();
        fake.checkRuns.set('octo/demo@abc', [{
            name: 'test',
            status: 'in_progress',
            conclusion: null,
        }]);
        expect(await denied(merge())).toBe('#3 has required checks that are not green: test.');
    });

    it.each([
        ['GET', '/repos/octo/demo/branches/main', 403],
        ['GET', '/repos/octo/demo/branches/main', 404],
        ['GET', '/repos/octo/demo/rules/branches/main', 403],
        ['GET', '/repos/octo/demo/rules/branches/main', 404],
    ])('refuses when %s %s answers %i (the required checks are unknown)', async (method, path, status) => {
        const {
            fake,
            merge,
            merges,
        } = mergeable();

        fake.failNext(method, path, status);
        fake.checkRuns.set('octo/demo@abc', [{
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
        }]);
        expect(await denied(merge())).toBe('The required checks of main could not be read (branch protection or rulesets); #3 must be merged by hand.');
        expect(merges()).toEqual([]);
    });

    it('refuses while no check has reported', async () => {
        const {
            fake,
            merge,
            merges,
        } = mergeable();

        fake.checkRuns.set('octo/demo@abc', []);
        expect(await denied(merge())).toBe('#3 has no checks reported yet; read its checks again once CI ran.');
        expect(merges()).toEqual([]);
    });

    it('refuses while a check that is not required is pending', async () => {
        const {
            fake,
            merge,
            merges,
            requireTest,
        } = mergeable(undefined, { mergeable_state: 'unstable' });

        requireTest();
        fake.checkRuns.set('octo/demo@abc', [
            {
                name: 'test',
                status: 'completed',
                conclusion: 'success',
            },
            {
                name: 'lint',
                status: 'in_progress',
                conclusion: null,
            },
        ]);
        expect(await denied(merge())).toBe('#3 has checks that are still running: lint.');
        expect(merges()).toEqual([]);
    });

    it('passes GitHub\'s 409 as a tool error', async () => {
        const { fake, merge } = mergeable();

        fake.route('PUT', '/repos/:owner/:repo/pulls/:number/merge', () => ({ status: 409, body: { message: 'Head branch was modified.' } }));

        const error = await merge().catch((e: unknown) => e);

        expect(error).not.toBeInstanceOf(ToolDeniedError);
        expect(error).toMatchObject({ code: 'github_request', message: expect.stringContaining('409') });
    });

    it('returns the merge after a lost record without a second PUT', async () => {
        const {
            merge,
            merges,
            wrap,
        } = mergeable();

        await merge();
        expect(await merge({}, wrap())).toEqual({
            number: 3,
            sha: 'merge-3',
            method: 'squash',
            alreadyMerged: true,
        });
        expect(merges()).toHaveLength(1);
    });

    it('never sends a bypass field', async () => {
        const { merge, merges } = mergeable();

        await merge({ commitTitle: 't', commitMessage: 'm' });

        for (const key of Object.keys(merges()[0]!.body as object)) {
            expect(['sha', 'merge_method', 'commit_title', 'commit_message']).toContain(key);
        }
    });
});
