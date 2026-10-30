/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, createMemoryStore, wrapToolsForRun } from '@chamvi/core';
import type { ToolSet } from 'ai';
import type { GithubIssueList, GithubRepositoryList } from '@chamvi/github';
import { createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';

function setup() {
    const fixture = createGithubFixture();
    const ctx = toolContext({ channel: 'cron' });
    const tools: ToolSet = wrapToolsForRun(fixture.gh.readTools(), ctx, createMemoryStore().effects);
    const call = <T = unknown>(name: string, input: unknown) => callTool<T>(tools, name, input, ctx);
    return { ...fixture, call };
}

function installation(id: number, login: string) {
    return {
        id, 
        account: { login, type: 'User' }, 
        repository_selection: 'all', 
        permissions: { contents: 'write' }, 
    };
}

describe('github_list_repositories', () => {
    it('lists the repositories of every installation sorted', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(43, installation(43, 'chamvi'));
        fake.appInstallations.set(42, installation(42, 'tada5hi'));
        fake.installations.set('tada5hi/zeta', 42);
        fake.installations.set('chamvi/chamvi', 43);
        fake.installations.set('tada5hi/Alpha', 42);
        fake.repositories.set('tada5hi/Alpha', {
            full_name: 'tada5hi/Alpha', 
            owner: { login: 'tada5hi' }, 
            private: true, 
            archived: false, 
            fork: false, 
            default_branch: 'develop', 
            html_url: 'https://github.com/tada5hi/Alpha', 
        });
        const result = await call<GithubRepositoryList>('github_list_repositories', {});
        expect(result).toEqual({
            repositories: [
                {
                    repo: 'chamvi/chamvi', 
                    installationId: 43, 
                    account: 'chamvi', 
                    private: false, 
                    archived: false, 
                    fork: false, 
                    defaultBranch: 'main', 
                    url: 'https://github.com/chamvi/chamvi', 
                },
                {
                    repo: 'tada5hi/Alpha', 
                    installationId: 42, 
                    account: 'tada5hi', 
                    private: true, 
                    archived: false, 
                    fork: false, 
                    defaultBranch: 'develop', 
                    url: 'https://github.com/tada5hi/Alpha', 
                },
                {
                    repo: 'tada5hi/zeta', 
                    installationId: 42, 
                    account: 'tada5hi', 
                    private: false, 
                    archived: false, 
                    fork: false, 
                    defaultBranch: 'main', 
                    url: 'https://github.com/tada5hi/zeta', 
                },
            ],
            truncated: false,
        });
    });

    it('drops archived repositories unless asked', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(42, installation(42, 'tada5hi'));
        fake.installations.set('tada5hi/old', 42);
        fake.installations.set('tada5hi/new', 42);
        fake.repositories.set('tada5hi/old', { full_name: 'tada5hi/old', archived: true });
        const names = async (input: unknown) => (await call<GithubRepositoryList>('github_list_repositories', input)).repositories.map((r) => r.repo);
        expect(await names({})).toEqual(['tada5hi/new']);
        expect(await names({ includeArchived: true })).toEqual(['tada5hi/new', 'tada5hi/old']);
    });

    it('cuts at REPOSITORIES_MAX', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(42, installation(42, 'tada5hi'));
        for (let i = 0; i < 1001; i++) fake.installations.set(`tada5hi/r${String(i).padStart(4, '0')}`, 42);
        const result = await call<GithubRepositoryList>('github_list_repositories', {});
        expect(result.repositories).toHaveLength(1000);
        expect(result.truncated).toBe(true);
    });

    it('skips a suspended installation', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(42, installation(42, 'tada5hi'));
        fake.appInstallations.set(43, { ...installation(43, 'chamvi'), suspended_at: '2026-10-20T09:00:00Z' });
        fake.installations.set('tada5hi/alpha', 42);
        fake.installations.set('chamvi/chamvi', 43);
        fake.failNext('POST', '/app/installations/43/access_tokens', 403);
        const result = await call<GithubRepositoryList>('github_list_repositories', {});
        expect(result.repositories.map((r) => r.repo)).toEqual(['tada5hi/alpha']);
    });

    it('fails as a tool error when one installation fails', async () => {
        const { fake, call } = setup();
        fake.appInstallations.set(42, installation(42, 'tada5hi'));
        fake.appInstallations.set(43, installation(43, 'chamvi'));
        fake.failNext('POST', '/app/installations/43/access_tokens', 500);
        await expect(call('github_list_repositories', {})).rejects.toMatchObject({ code: 'github_request' });
    });
});

describe('github_list_issues', () => {
    function issue(number: number, patch: Record<string, unknown> = {}) {
        return {
            number,
            title: `Issue ${number}`,
            state: 'open',
            labels: [{ name: 'bug' }],
            user: { login: 'alice', type: 'User' },
            comments: 1,
            created_at: '2026-10-19T09:00:00Z',
            updated_at: '2026-10-20T09:00:00Z',
            html_url: `https://github.com/octo/demo/issues/${number}`,
            ...patch,
        };
    }

    it('lists open issues without pull requests', async () => {
        const { fake, call } = setup();
        fake.installations.set('octo/demo', 9);
        fake.issues.set('octo/demo#1', issue(1));
        fake.issues.set('octo/demo#2', issue(2, { pull_request: { url: 'x' } }));
        fake.issues.set('octo/demo#3', issue(3, { state: 'closed' }));
        const result = await call<GithubIssueList>('github_list_issues', { repo: 'octo/demo' });
        expect(result).toEqual({
            issues: [{
                number: 1, 
                title: 'Issue 1', 
                author: 'alice', 
                labels: ['bug'], 
                comments: 1, 
                createdAt: '2026-10-19T09:00:00Z', 
                updatedAt: '2026-10-20T09:00:00Z', 
                url: 'https://github.com/octo/demo/issues/1', 
            }],
            truncated: false,
        });
        expect(fake.tokenInstallations).toEqual([9]);
        expect(fake.requests.find((r) => r.path === '/repos/octo/demo/issues')?.query).toMatchObject({ state: 'open', per_page: '100' });
    });

    it('passes labels', async () => {
        const { fake, call } = setup();
        fake.installations.set('octo/demo', 9);
        await call('github_list_issues', { repo: 'octo/demo', labels: ['bug', 'help wanted'] });
        expect(fake.requests.find((r) => r.path === '/repos/octo/demo/issues')?.query).toMatchObject({ labels: 'bug,help wanted' });
    });

    it('cuts at limit', async () => {
        const { fake, call } = setup();
        fake.installations.set('octo/demo', 9);
        for (let n = 1; n <= 5; n++) fake.issues.set(`octo/demo#${n}`, issue(n));
        const result = await call<GithubIssueList>('github_list_issues', { repo: 'octo/demo', limit: 3 });
        expect(result.issues.map((i) => i.number)).toEqual([1, 2, 3]);
        expect(result.truncated).toBe(true);
    });

    it('refuses a limit above ISSUES_MAX', async () => {
        const { call } = setup();
        await expect(call('github_list_issues', { repo: 'octo/demo', limit: 101 })).rejects.toBeInstanceOf(ValidationError);
        await expect(call('github_list_issues', { repo: 'octo/demo', labels: [''] })).rejects.toBeInstanceOf(ValidationError);
    });
});
