/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryRepositories, wrapToolsForRun } from '@chamvi/core';
import type { ToolSet } from 'ai';
import type { GithubCheck, GithubPullRequestChecks } from '@chamvi/github';
import { summarizeChecks } from '../../../src/tools/checks.ts';
import { createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';

function check(name: string, outcome: GithubCheck['outcome'], required = false): GithubCheck {
    return {
        name,
        kind: 'check_run',
        status: outcome === 'pending' ? 'in_progress' : 'completed',
        conclusion: outcome === 'pending' ? null : outcome,
        outcome,
        required,
        url: null,
    };
}

function run(name: string, status: string, conclusion: string | null = null) {
    return {
        name, 
        status, 
        conclusion, 
        html_url: `https://github.com/octo/demo/runs/${name}`, 
    };
}

function setup() {
    const fixture = createGithubFixture();
    const ctx = toolContext({ channel: 'cron' });
    const tools: ToolSet = wrapToolsForRun(fixture.gh.readTools(), ctx, createMemoryRepositories().effects);
    const call = <T = unknown>(name: string, input: unknown) => callTool<T>(tools, name, input, ctx);
    fixture.fake.installations.set('octo/demo', 9);
    fixture.fake.pulls.set('octo/demo#1', {
        number: 1,
        title: 'Bump',
        state: 'open',
        head: {
            ref: 'deps', 
            sha: 'abc', 
            repo: { full_name: 'octo/demo' }, 
        },
        base: { ref: 'main', repo: { full_name: 'octo/demo' } },
    });
    const checks = () => call<GithubPullRequestChecks>('github_get_pull_request_checks', { repo: 'octo/demo', number: 1 });
    return {
        ...fixture, 
        call, 
        checks, 
    };
}

describe('summarizeChecks', () => {
    it('reads none without any report', () => expect(summarizeChecks([], []).state).toBe('none'));

    it('counts a missing required context as pending', () => {
        expect(summarizeChecks([check('lint', 'success')], ['test'])).toEqual({
            state: 'pending', 
            missing: ['test'], 
            pending: 0, 
            failing: 0, 
        });
        expect(summarizeChecks([], ['test']).state).toBe('pending');
    });

    it('reads success when every check succeeded', () => {
        expect(summarizeChecks([check('lint', 'success', true)], ['lint'])).toEqual({
            state: 'success', 
            missing: [], 
            pending: 0, 
            failing: 0, 
        });
    });

    it('failure wins over pending', () => {
        expect(summarizeChecks([check('lint', 'pending'), check('test', 'failure')], ['e2e'])).toMatchObject({
            state: 'failure', 
            pending: 1, 
            failing: 1, 
            missing: ['e2e'], 
        });
    });
});

describe('github_get_pull_request_checks', () => {
    it.each(['success', 'neutral', 'skipped'])('reads %s as success', async (conclusion) => {
        const { fake, checks } = setup();
        fake.checkRuns.set('octo/demo@abc', [run('lint', 'completed', conclusion)]);
        const result = await checks();
        expect(result.checks[0]).toMatchObject({ outcome: 'success', conclusion });
        expect(result.state).toBe('success');
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'])('reads %s as failure', async (conclusion) => {
        const { fake, checks } = setup();
        fake.checkRuns.set('octo/demo@abc', [run('lint', 'completed', conclusion)]);
        const result = await checks();
        expect(result.checks[0]!.outcome).toBe('failure');
        expect(result).toMatchObject({ state: 'failure', failing: 1 });
    });

    it.each(['queued', 'in_progress', 'waiting', 'requested', 'pending'])('reads a %s check run as pending', async (status) => {
        const { fake, checks } = setup();
        fake.checkRuns.set('octo/demo@abc', [run('lint', status)]);
        expect(await checks()).toMatchObject({ state: 'pending', pending: 1 });
    });

    it('reads none without any report', async () => {
        const { checks } = setup();
        expect(await checks()).toEqual({
            number: 1,
            headSha: 'abc',
            base: 'main',
            state: 'none',
            pending: 0,
            failing: 0,
            checks: [],
            required: {
                known: true, 
                contexts: [], 
                missing: [], 
            },
            truncated: false,
        });
    });

    it('combines check runs and commit statuses of the head sha', async () => {
        const { fake, checks } = setup();
        fake.checkRuns.set('octo/demo@abc', [run('lint', 'completed', 'success')]);
        fake.statuses.set('octo/demo@abc', [
            {
                context: 'ci/legacy', 
                state: 'success', 
                target_url: 'https://ci.example/1', 
            },
            {
                context: 'ci/deploy', 
                state: 'error', 
                target_url: null, 
            },
            { context: 'ci/slow', state: 'pending' },
        ]);
        const result = await checks();
        expect(result.checks).toEqual([
            {
                name: 'lint', 
                kind: 'check_run', 
                status: 'completed', 
                conclusion: 'success', 
                outcome: 'success', 
                required: false, 
                url: 'https://github.com/octo/demo/runs/lint', 
            },
            {
                name: 'ci/legacy', 
                kind: 'status', 
                status: 'success', 
                conclusion: null, 
                outcome: 'success', 
                required: false, 
                url: 'https://ci.example/1', 
            },
            {
                name: 'ci/deploy', 
                kind: 'status', 
                status: 'error', 
                conclusion: null, 
                outcome: 'failure', 
                required: false, 
                url: null, 
            },
            {
                name: 'ci/slow', 
                kind: 'status', 
                status: 'pending', 
                conclusion: null, 
                outcome: 'pending', 
                required: false, 
                url: null, 
            },
        ]);
        expect(result).toMatchObject({
            state: 'failure', 
            failing: 1, 
            pending: 1, 
        });
        expect(fake.requests.find((r) => r.path.endsWith('/check-runs'))?.query).toMatchObject({ filter: 'latest' });
    });

    it('marks required checks from branch protection and rulesets', async () => {
        const { fake, checks } = setup();
        fake.branches.set('octo/demo:main', {
            name: 'main',
            protected: true,
            protection: { enabled: true, required_status_checks: { contexts: ['lint'], checks: [{ context: 'lint' }, { context: 'build' }] } },
        });
        fake.rules.set('octo/demo:main', [
            { type: 'pull_request', parameters: {} },
            { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test' }, { context: 'lint' }] } },
        ]);
        fake.checkRuns.set('octo/demo@abc', [run('lint', 'completed', 'success'), run('test', 'completed', 'success'), run('docs', 'completed', 'success')]);
        const result = await checks();
        expect(result.required).toEqual({
            known: true, 
            contexts: ['lint', 'build', 'test'], 
            missing: ['build'], 
        });
        expect(result.checks.map((c) => [c.name, c.required])).toEqual([['lint', true], ['test', true], ['docs', false]]);
        expect(result.state).toBe('pending');
    });

    it('reports required.known false when protection answers 403', async () => {
        const { fake, checks } = setup();
        fake.rules.set('octo/demo:main', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test' }] } }]);
        fake.failNext('GET', '/repos/octo/demo/branches/main', 403);
        const result = await checks();
        expect(result.required).toEqual({
            known: false, 
            contexts: ['test'], 
            missing: ['test'], 
        });
    });

    it('reports required.known false when the rulesets answer 404', async () => {
        const { fake, checks } = setup();
        fake.failNext('GET', '/repos/octo/demo/rules/branches/main', 404);
        expect((await checks()).required.known).toBe(false);
    });

    it('fails as a tool error on another protection failure', async () => {
        const { fake, checks } = setup();
        fake.failNext('GET', '/repos/octo/demo/branches/main', 500);
        await expect(checks()).rejects.toMatchObject({ code: 'github_request' });
    });

    it('cuts at CHECKS_MAX check runs', async () => {
        const { fake, checks } = setup();
        fake.checkRuns.set('octo/demo@abc', Array.from({ length: 301 }, (_, i) => run(`c${i}`, 'completed', 'success')));
        const result = await checks();
        expect(result.checks).toHaveLength(300);
        expect(result.truncated).toBe(true);
    });
});
