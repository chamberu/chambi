/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore, ValidationError, wrapToolsForRun } from '@chamvi/core';
import type { ToolSet } from 'ai';
import type { GithubPullRequestList, GithubPushTarget } from '@chamvi/github';
import { createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';

function setup() {
    const fixture = createGithubFixture();
    const ctx = toolContext({ channel: 'cron' });
    const tools: ToolSet = wrapToolsForRun(fixture.gh.readTools(), ctx, new MemoryStore());
    const call = <T = unknown>(name: string, input: unknown) => callTool<T>(tools, name, input, ctx);
    fixture.fake.installations.set('octo/demo', 9);
    fixture.fake.appInstallations.set(9, {
        id: 9, 
        account: { login: 'octo', type: 'Organization' }, 
        repository_selection: 'all', 
        permissions: { contents: 'write', pull_requests: 'write' }, 
    });
    return { ...fixture, call };
}

function pull(number: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        number,
        title: `PR ${number}`,
        state: 'open',
        draft: false,
        merged: false,
        mergeable: true,
        mergeable_state: 'clean',
        maintainer_can_modify: false,
        user: { login: 'dependabot[bot]', type: 'Bot' },
        labels: [{ name: 'dependencies' }],
        head: {
            ref: `deps-${number}`, 
            label: `octo:deps-${number}`, 
            sha: `sha-${number}`, 
            repo: { full_name: 'octo/demo' }, 
        },
        base: { ref: 'main', repo: { full_name: 'octo/demo' } },
        created_at: '2026-10-19T09:00:00Z',
        updated_at: '2026-10-20T09:00:00Z',
        html_url: `https://github.com/octo/demo/pull/${number}`,
        ...patch,
    };
}

describe('github_list_pull_requests', () => {
    it('lists open pull requests with fork flags', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#1', pull(1));
        fake.pulls.set('octo/demo#2', pull(2, {
            user: { login: 'someone', type: 'User' },
            head: {
                ref: 'patch', 
                label: 'someone:patch', 
                sha: 'sha-2', 
                repo: { full_name: 'someone/demo' }, 
            },
        }));
        fake.pulls.set('octo/demo#3', pull(3, { state: 'closed' }));
        const result = await call<GithubPullRequestList>('github_list_pull_requests', { repo: 'octo/demo' });
        expect(result).toEqual({
            pullRequests: [
                {
                    number: 1,
                    title: 'PR 1',
                    author: 'dependabot[bot]',
                    authorType: 'Bot',
                    draft: false,
                    base: 'main',
                    head: 'deps-1',
                    headSha: 'sha-1',
                    headRepo: 'octo/demo',
                    fork: false,
                    labels: ['dependencies'],
                    createdAt: '2026-10-19T09:00:00Z',
                    updatedAt: '2026-10-20T09:00:00Z',
                    url: 'https://github.com/octo/demo/pull/1',
                },
                expect.objectContaining({
                    number: 2, 
                    author: 'someone', 
                    authorType: 'User', 
                    headRepo: 'someone/demo', 
                    fork: true, 
                }),
            ],
            truncated: false,
        });
        expect(fake.tokenInstallations).toEqual([9]);
    });

    it('filters by base', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#1', pull(1));
        fake.pulls.set('octo/demo#2', pull(2, { base: { ref: 'develop', repo: { full_name: 'octo/demo' } } }));
        const result = await call<GithubPullRequestList>('github_list_pull_requests', { repo: 'octo/demo', base: 'develop' });
        expect(result.pullRequests.map((p) => p.number)).toEqual([2]);
        await expect(call('github_list_pull_requests', { repo: 'octo/demo', base: 'a b' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('cuts at limit', async () => {
        const { fake, call } = setup();
        for (let n = 1; n <= 4; n++) fake.pulls.set(`octo/demo#${n}`, pull(n));
        const result = await call<GithubPullRequestList>('github_list_pull_requests', { repo: 'octo/demo', limit: 2 });
        expect(result.pullRequests.map((p) => p.number)).toEqual([1, 2]);
        expect(result.truncated).toBe(true);
        await expect(call('github_list_pull_requests', { repo: 'octo/demo', limit: 101 })).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('github_get_push_target', () => {
    it('can push to the same repository with contents write', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#1', pull(1));
        expect(await call<GithubPushTarget>('github_get_push_target', { repo: 'octo/demo', number: 1 })).toEqual({
            number: 1,
            headRepo: 'octo/demo',
            headBranch: 'deps-1',
            headSha: 'sha-1',
            fork: false,
            installationId: 9,
            contents: 'write',
            workflows: null,
            maintainerCanModify: false,
            canPush: true,
            reason: null,
        });
    });

    it('reads the permissions from the cached repository installation, never the installation list', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#1', pull(1));
        await call('github_get_push_target', { repo: 'octo/demo', number: 1 });
        await call('github_get_push_target', { repo: 'octo/demo', number: 1 });
        expect(fake.requests.filter((r) => r.path === '/app/installations')).toEqual([]);
        expect(fake.requests.filter((r) => r.path === '/repos/octo/demo/installation')).toHaveLength(1);
    });

    it('cannot push to an uninstalled fork', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#2', pull(2, {
            maintainer_can_modify: true,
            head: {
                ref: 'patch', 
                label: 'someone:patch', 
                sha: 'sha-2', 
                repo: { full_name: 'someone/demo' }, 
            },
        }));
        expect(await call<GithubPushTarget>('github_get_push_target', { repo: 'octo/demo', number: 2 })).toMatchObject({
            headRepo: 'someone/demo',
            fork: true,
            installationId: null,
            contents: null,
            maintainerCanModify: true,
            canPush: false,
            reason: 'GitHub App not installed on someone/demo',
        });
    });

    it('cannot push to a deleted head', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#3', pull(3, {
            head: {
                ref: 'gone', 
                sha: 'sha-3', 
                repo: null, 
            }, 
        }));
        expect(await call<GithubPushTarget>('github_get_push_target', { repo: 'octo/demo', number: 3 })).toMatchObject({
            headRepo: null,
            fork: true,
            installationId: null,
            canPush: false,
            reason: 'head repository deleted',
        });
    });

    it('cannot push with a read-only installation', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(9, {
            id: 9, 
            account: { login: 'octo', type: 'Organization' }, 
            repository_selection: 'all', 
            permissions: { contents: 'read' }, 
        });
        fake.pulls.set('octo/demo#1', pull(1));
        expect(await call<GithubPushTarget>('github_get_push_target', { repo: 'octo/demo', number: 1 })).toMatchObject({
            installationId: 9,
            contents: 'read',
            canPush: false,
            reason: 'installation has no contents write',
        });
    });

    it('reports the workflows permission', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(9, {
            id: 9, 
            account: { login: 'octo', type: 'Organization' }, 
            repository_selection: 'all', 
            permissions: { contents: 'write', workflows: 'write' }, 
        });
        fake.pulls.set('octo/demo#1', pull(1));
        expect(await call<GithubPushTarget>('github_get_push_target', { repo: 'octo/demo', number: 1 })).toMatchObject({ workflows: 'write', canPush: true });
    });

    it('can push to a fork the App is installed on', async () => {
        const { fake, call } = setup();
        fake.installations.set('someone/demo', 11);
        fake.appInstallations.set(11, {
            id: 11, 
            account: { login: 'someone', type: 'User' }, 
            repository_selection: 'selected', 
            permissions: { contents: 'write' }, 
        });
        fake.pulls.set('octo/demo#2', pull(2, {
            head: {
                ref: 'patch', 
                label: 'someone:patch', 
                sha: 'sha-2', 
                repo: { full_name: 'someone/demo' }, 
            },
        }));
        expect(await call<GithubPushTarget>('github_get_push_target', { repo: 'octo/demo', number: 2 })).toMatchObject({
            fork: true, 
            installationId: 11, 
            contents: 'write', 
            canPush: true, 
            reason: null, 
        });
    });
});
