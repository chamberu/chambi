/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    Engine,
    FatalToolError,
    MemoryStore,
    ValidationError,
    defineAgent,
    wrapToolsForRun,
} from '@chamvi/core';
import type { ToolSet } from 'ai';
import { createGithubApp, github, githubChannel } from '@chamvi/github';
import type { GithubAppOptions } from '@chamvi/github';
import { WEBHOOK_SECRET, createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';
import type { ToolContextInput } from '../../utils/tools.ts';
import { mockModel } from '../../utils/model.ts';

const ISSUE = {
    number: 5,
    title: 'Crash when the config file is empty',
    body: 'It throws.',
    state: 'open',
    labels: [{ name: 'bug' }, 'triage'],
    user: { login: 'alice', type: 'User' },
    html_url: 'https://github.com/octo/demo/issues/5',
    created_at: '2026-10-20T09:58:00Z',
    comments: 2,
    node_id: 'I_kw',
    reactions: { total_count: 0 },
};

function setup(github: Partial<GithubAppOptions> = {}, context: ToolContextInput = {}) {
    const fixture = createGithubFixture(github);
    const ctx = toolContext(context);
    const tools: ToolSet = wrapToolsForRun(fixture.gh.readTools(), ctx, new MemoryStore());
    const call = <T = unknown>(name: string, input: unknown) => callTool<T>(tools, name, input, ctx);
    return {
        ...fixture,
        ctx,
        tools,
        call,
    };
}

describe('read tools', () => {
    it('offers the read tools only', () => {
        const { gh } = createGithubFixture();
        expect(Object.keys(gh.readTools()).sort()).toEqual([
            'github_compare',
            'github_get_file',
            'github_get_issue',
            'github_get_latest_release',
            'github_get_pull_request',
            'github_list_labels',
            'github_list_releases',
            'github_search_issues',
        ]);
    });

    it('github_get_issue returns a slim issue', async () => {
        const { fake, call } = setup();
        fake.issues.set('octo/demo#5', { ...ISSUE });
        fake.issues.set('octo/demo#6', {
            ...ISSUE,
            number: 6,
            pull_request: { url: 'x' },
        });
        expect(await call('github_get_issue', { repo: 'octo/demo', number: 5 })).toEqual({
            number: 5,
            title: 'Crash when the config file is empty',
            body: 'It throws.',
            state: 'open',
            labels: ['bug', 'triage'],
            author: 'alice',
            url: 'https://github.com/octo/demo/issues/5',
            createdAt: '2026-10-20T09:58:00Z',
            comments: 2,
            isPullRequest: false,
        });
        expect(await call('github_get_issue', { repo: 'octo/demo', number: 6 })).toMatchObject({ isPullRequest: true });
        expect(fake.requests.at(-1)).toMatchObject({ method: 'GET', path: '/repos/octo/demo/issues/6' });
        expect(fake.tokenInstallations).toEqual([42]);
    });

    it('github_search_issues sends the query and limit', async () => {
        const { fake, call } = setup();
        fake.issues.set('octo/demo#5', { ...ISSUE, repository_url: 'https://api.github.com/repos/octo/demo' });
        const result = await call('github_search_issues', { query: 'Crash' });
        expect(result).toEqual({
            total: 1,
            items: [{
                repo: 'octo/demo',
                number: 5,
                title: ISSUE.title,
                state: 'open',
                url: ISSUE.html_url,
            }],
        });
        expect(fake.requests.at(-1)).toMatchObject({
            path: '/search/issues',
            query: {
                q: 'Crash',
                per_page: '10',
                advanced_search: 'true',
            },
        });
        await call('github_search_issues', { query: 'x', limit: 20 });
        expect(fake.requests.at(-1)?.query.per_page).toBe('20');
        await expect(call('github_search_issues', { query: 'x', limit: 21 })).rejects.toBeInstanceOf(ValidationError);
    });

    it('github_list_labels pages through every label', async () => {
        const { fake, call } = setup();
        fake.labels.set('octo/demo', Array.from({ length: 150 }, (_, i) => ({
            id: i,
            name: `l${i}`,
            description: i === 0 ? null : `d${i}`,
            color: 'fff',
        })));
        const labels = await call<Array<{ name: string; description: string | null }>>('github_list_labels', { repo: 'octo/demo' });
        expect(labels).toHaveLength(150);
        expect(labels[0]).toEqual({ name: 'l0', description: null });
        expect(labels[149]).toEqual({ name: 'l149', description: 'd149' });
        const pages = fake.requests.filter((r) => r.path === '/repos/octo/demo/labels');
        expect(pages.map((r) => r.query.per_page)).toEqual(['100', '100']);
    });

    it('github_get_pull_request returns a slim pull request', async () => {
        const { fake, call } = setup();
        fake.pulls.set('octo/demo#7', {
            number: 7,
            title: 'Fix the crash',
            body: 'Fixes #5',
            state: 'open',
            draft: false,
            merged: false,
            base: { ref: 'main', sha: 'a' },
            head: { ref: 'fix/crash', sha: 'b' },
            user: { login: 'bob' },
            html_url: 'https://github.com/octo/demo/pull/7',
            changed_files: 3,
        });
        expect(await call('github_get_pull_request', { repo: 'octo/demo', number: 7 })).toEqual({
            number: 7,
            title: 'Fix the crash',
            body: 'Fixes #5',
            state: 'open',
            draft: false,
            merged: false,
            base: 'main',
            head: 'fix/crash',
            author: 'bob',
            url: 'https://github.com/octo/demo/pull/7',
            changedFiles: 3,
        });
    });

    it('github_get_file reads a file, truncates large files and lists directories', async () => {
        const { fake, call } = setup();
        const file = (path: string, text: string) => ({
            type: 'file',
            name: path.split('/').at(-1),
            path,
            size: Buffer.byteLength(text),
            encoding: 'base64',
            content: Buffer.from(text).toString('base64'),
        });
        fake.files.set('octo/demo:src/index.ts', file('src/index.ts', 'export {};\n'));
        fake.files.set('octo/demo:src/big.txt', file('src/big.txt', 'é'.repeat(70_000)));
        fake.files.set('octo/demo:src/lib/a.ts', file('src/lib/a.ts', 'a'));

        expect(await call('github_get_file', {
            repo: 'octo/demo',
            path: 'src/index.ts',
            ref: 'main',
        })).toEqual({
            path: 'src/index.ts',
            size: 11,
            content: 'export {};\n',
            truncated: false,
        });
        // Octokit encodes the slashes of the path parameter; GitHub decodes them
        expect(decodeURIComponent(fake.requests.at(-1)!.path)).toBe('/repos/octo/demo/contents/src/index.ts');
        expect(fake.requests.at(-1)?.query).toEqual({ ref: 'main' });

        const big = await call<{ content: string; truncated: boolean }>('github_get_file', { repo: 'octo/demo', path: 'src/big.txt' });
        expect(big.truncated).toBe(true);
        expect(big.content).toHaveLength(65_536);

        expect(await call('github_get_file', { repo: 'octo/demo', path: 'src' })).toEqual({
            path: 'src',
            entries: [
                {
                    name: 'index.ts',
                    type: 'file',
                    path: 'src/index.ts',
                },
                {
                    name: 'big.txt',
                    type: 'file',
                    path: 'src/big.txt',
                },
            ],
        });
    });

    it('github_get_latest_release returns the release or none', async () => {
        const { fake, call } = setup();
        expect(await call('github_get_latest_release', { repo: 'octo/demo' })).toEqual({ none: true });
        fake.releases.set('octo/demo', [{
            tag_name: 'v1.2.0',
            name: '1.2.0',
            published_at: '2026-10-01T00:00:00Z',
            html_url: 'https://github.com/octo/demo/releases/tag/v1.2.0',
            body: 'Notes',
            assets: [],
        }]);
        expect(await call('github_get_latest_release', { repo: 'octo/demo' })).toEqual({
            tag: 'v1.2.0',
            name: '1.2.0',
            publishedAt: '2026-10-01T00:00:00Z',
            url: 'https://github.com/octo/demo/releases/tag/v1.2.0',
            body: 'Notes',
        });
    });

    describe('github_list_releases', () => {
        const release = (tag: string, day: number, extra: Record<string, unknown> = {}) => ({
            tag_name: tag,
            name: tag,
            draft: false,
            prerelease: false,
            published_at: `2026-0${Math.ceil(day / 28)}-${String(((day - 1) % 28) + 1).padStart(2, '0')}T00:00:00Z`,
            html_url: `https://github.com/octo/demo/releases/tag/${tag}`,
            body: `Notes for ${tag}`,
            ...extra,
        });

        function withReleases() {
            const fixture = setup();
            fixture.fake.releases.set('octo/demo', [
                release('0.9.0', 1),
                release('v1.0.0', 2),
                release('1.1.0', 3),
                release('v1.2.0-rc.1', 4, { prerelease: true }),
                release('v1.2.0', 5),
                release('v1.3.0', 6, { draft: true }),
                release('nightly', 7),
                release('v1.3.0', 8),
            ]);
            return fixture;
        }

        it('returns the releases after from up to and including to, oldest first', async () => {
            const { call } = withReleases();

            const result = await call<{ releases: Array<{ tag: string; prerelease: boolean }>; truncated: boolean }>(
                'github_list_releases',
                {
                    repo: 'octo/demo',
                    from: '1.0.0',
                    to: 'v1.2.0',
                },
            );
            expect(result.truncated).toBe(false);
            expect(result.releases.map((r) => r.tag)).toEqual(['1.1.0', 'v1.2.0-rc.1', 'v1.2.0']);
            expect(result.releases[1]!.prerelease).toBe(true);
            expect(result.releases[2]).toEqual({
                tag: 'v1.2.0',
                name: 'v1.2.0',
                publishedAt: '2026-01-05T00:00:00Z',
                url: 'https://github.com/octo/demo/releases/tag/v1.2.0',
                prerelease: false,
                body: 'Notes for v1.2.0',
                bodyTruncated: false,
            });
        });

        it('skips drafts and, with bounds, tags that are no version', async () => {
            const { call } = withReleases();

            const result = await call<{ releases: Array<{ tag: string }> }>('github_list_releases', { repo: 'octo/demo', from: 'v1.2.0' });
            expect(result.releases.map((r) => r.tag)).toEqual(['v1.3.0']);
        });

        it('returns the newest releases without bounds, oldest first', async () => {
            const { call } = withReleases();

            const result = await call<{ releases: Array<{ tag: string }> }>('github_list_releases', { repo: 'octo/demo' });
            expect(result.releases.map((r) => r.tag)).toEqual(['0.9.0', 'v1.0.0', '1.1.0', 'v1.2.0-rc.1', 'v1.2.0', 'nightly', 'v1.3.0']);
        });

        it('reads a monorepo package by tag prefix', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', [
                release('@octo/a@1.0.0', 1),
                release('@octo/b@2.0.0', 2),
                release('@octo/a@1.1.0', 3),
            ]);

            const result = await call<{ releases: Array<{ tag: string }> }>(
                'github_list_releases',
                {
                    repo: 'octo/demo',
                    tagPrefix: '@octo/a@',
                    from: '1.0.0',
                },
            );
            expect(result.releases.map((r) => r.tag)).toEqual(['@octo/a@1.1.0']);
        });

        it('caps the bodies and the number of releases', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', Array.from({ length: 25 }, (_, i) => release(`v1.${i}.0`, i + 1, { body: 'x'.repeat(9_000) })));

            const result = await call<{
                releases: Array<{
                    tag: string;
                    body: string;
                    bodyTruncated: boolean
                }>;
                truncated: boolean
            }>(
                'github_list_releases',
                { repo: 'octo/demo', from: 'v1.0.0' },
            );
            expect(result.truncated).toBe(true);
            expect(result.releases).toHaveLength(20);
            expect(result.releases[0]!.tag).toBe('v1.1.0');
            expect(result.releases[0]!.body).toHaveLength(8_000);
            expect(result.releases[0]!.bodyTruncated).toBe(true);
        });

        it('pages through the releases', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', Array.from({ length: 150 }, (_, i) => release(`v0.${i}.0`, (i % 28) + 1)));

            const result = await call<{ releases: Array<{ tag: string }> }>('github_list_releases', {
                repo: 'octo/demo',
                from: 'v0.0.0',
                to: 'v0.2.0',
            });
            expect(result.releases.map((r) => r.tag)).toEqual(['v0.1.0', 'v0.2.0']);
            expect(fake.requests.filter((r) => r.path.endsWith('/releases')).length).toBe(2);
        });

        it('keeps reading past a backport published after the wanted range', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', [
                ...Array.from({ length: 111 }, (_, i) => release(`v2.${i}.0`, (i % 28) + 1)),
                release('v3.0.0', 1),
                release('v1.9.9', 2),
            ]);

            const result = await call<{ releases: Array<{ tag: string }>; truncated: boolean }>('github_list_releases', {
                repo: 'octo/demo',
                from: '2.5.0',
                to: '2.20.0',
            });
            expect(result.releases.map((r) => r.tag)).toEqual(Array.from({ length: 15 }, (_, i) => `v2.${i + 6}.0`));
            expect(result.truncated).toBe(false);
        });

        it('reads every page with exhaustive, also past a whole page below from', async () => {
            const { fake, call } = setup();
            // a page of old-line releases published after the one in range (the fake lists newest last)
            fake.releases.set('octo/demo', [
                release('v2.1.0', 1),
                ...Array.from({ length: 100 }, (_, i) => release(`v1.${i}.0`, 20)),
            ]);
            const input = { repo: 'octo/demo', from: '2.0.0' };

            const quick = await call<{ releases: Array<{ tag: string }> }>('github_list_releases', input);
            expect(quick.releases).toEqual([]);
            const full = await call<{ releases: Array<{ tag: string }> }>('github_list_releases', { ...input, exhaustive: true });
            expect(full.releases.map((r) => r.tag)).toEqual(['v2.1.0']);
        });

        it('reads one page for the newest releases without from', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', Array.from({ length: 1_000 }, (_, i) => release(`v1.${i}.0`, (i % 28) + 1)));

            const result = await call<{ releases: Array<{ tag: string }>; truncated: boolean }>('github_list_releases', { repo: 'octo/demo' });
            expect(fake.requests.filter((r) => r.path.endsWith('/releases')).length).toBe(1);
            expect(result.releases.map((r) => r.tag)).toEqual(Array.from({ length: 20 }, (_, i) => `v1.${i + 980}.0`));
            // older releases matched too
            expect(result.truncated).toBe(true);
        });

        it('reads until enough releases of a tag prefix matched without from', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', [
                ...Array.from({ length: 30 }, (_, i) => release(`pkg-a@1.${i}.0`, (i % 28) + 1)),
                ...Array.from({ length: 200 }, (_, i) => release(`pkg-b@1.${i}.0`, (i % 28) + 1)),
                ...Array.from({ length: 10 }, (_, i) => release(`pkg-a@2.${i}.0`, (i % 28) + 1)),
            ]);

            const result = await call<{ releases: Array<{ tag: string }>; truncated: boolean }>(
                'github_list_releases',
                { repo: 'octo/demo', tagPrefix: 'pkg-a@' },
            );
            expect(fake.requests.filter((r) => r.path.endsWith('/releases')).length).toBe(3);
            expect(result.releases.map((r) => r.tag)).toEqual([
                ...Array.from({ length: 10 }, (_, i) => `pkg-a@1.${i + 20}.0`),
                ...Array.from({ length: 10 }, (_, i) => `pkg-a@2.${i}.0`),
            ]);
        });

        it('stops reading up to to once a whole page is below the newest releases found', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', Array.from({ length: 1_000 }, (_, i) => release(`v1.${i}.0`, (i % 28) + 1)));

            const result = await call<{ releases: Array<{ tag: string }>; truncated: boolean }>(
                'github_list_releases',
                { repo: 'octo/demo', to: 'v1.950.0' },
            );
            expect(fake.requests.filter((r) => r.path.endsWith('/releases')).length).toBe(2);
            expect(result.releases.map((r) => r.tag)).toEqual(Array.from({ length: 20 }, (_, i) => `v1.${i + 931}.0`));
        });

        it('reports a range the page cap left unread as truncated', async () => {
            const { fake, call } = setup();
            fake.releases.set('octo/demo', [
                ...Array.from({ length: 10 }, (_, i) => release(`v1.${i}.0`, i + 1)),
                ...Array.from({ length: 1_000 }, (_, i) => release(`nightly-${i}`, (i % 28) + 1)),
            ]);

            const result = await call<{ releases: Array<{ tag: string }>; truncated: boolean }>('github_list_releases', {
                repo: 'octo/demo',
                from: '1.0.0',
                to: '1.5.0',
            });
            expect(fake.requests.filter((r) => r.path.endsWith('/releases')).length).toBe(10);
            expect(result.truncated).toBe(true);
        });
    });

    describe('github_compare', () => {
        function withComparison(commits = 2, files = 1) {
            const fixture = setup();
            fixture.fake.route('GET', '/repos/:owner/:repo/compare/:basehead', ({ params }) => ({
                status: 200,
                body: {
                    status: 'ahead',
                    ahead_by: commits,
                    behind_by: 0,
                    total_commits: commits,
                    html_url: `https://github.com/${params.owner}/${params.repo}/compare/${params.basehead}`,
                    commits: Array.from({ length: commits }, (_, i) => ({
                        sha: `sha${i}`,
                        commit: { message: `feat: change ${i}\n\nlong body`, author: { name: 'Alice', date: '2026-10-01T00:00:00Z' } },
                        author: { login: 'alice' },
                    })),
                    files: Array.from({ length: files }, (_, i) => ({
                        filename: `src/f${i}.ts`,
                        status: 'modified',
                        additions: 3,
                        deletions: 1,
                        changes: 4,
                        patch: '@@',
                    })),
                },
            }));
            return fixture;
        }

        it('returns the commits and changed files between two refs', async () => {
            const { fake, call } = withComparison();

            expect(await call('github_compare', {
                repo: 'octo/demo',
                base: 'v1.0.0',
                head: 'v1.1.0',
            })).toEqual({
                status: 'ahead',
                aheadBy: 2,
                behindBy: 0,
                totalCommits: 2,
                url: 'https://github.com/octo/demo/compare/v1.0.0...v1.1.0',
                commits: [
                    {
                        sha: 'sha0',
                        message: 'feat: change 0',
                        author: 'alice',
                        date: '2026-10-01T00:00:00Z',
                    },
                    {
                        sha: 'sha1',
                        message: 'feat: change 1',
                        author: 'alice',
                        date: '2026-10-01T00:00:00Z',
                    },
                ],
                files: [{
                    path: 'src/f0.ts',
                    status: 'modified',
                    additions: 3,
                    deletions: 1,
                }],
                truncated: false,
            });
            expect(fake.requests.at(-1)!.path).toBe('/repos/octo/demo/compare/v1.0.0...v1.1.0');
        });

        it('caps commits and files', async () => {
            const { call } = withComparison(120, 310);

            const result = await call<{
                commits: unknown[];
                files: unknown[];
                truncated: boolean
            }>(
                'github_compare',
                {
                    repo: 'octo/demo',
                    base: 'a',
                    head: 'b',
                },
            );
            expect(result.commits).toHaveLength(100);
            expect(result.files).toHaveLength(300);
            expect(result.truncated).toBe(true);
        });

        it('asks for the first, oldest page of commits and reports the rest by total_commits', async () => {
            const fixture = withComparison(2);
            fixture.fake.route('GET', '/repos/:owner/:repo/compare/:basehead', () => ({
                status: 200,
                body: {
                    status: 'ahead',
                    ahead_by: 400,
                    behind_by: 0,
                    total_commits: 400,
                    html_url: 'u',
                    files: [],
                    commits: [{
                        sha: 'oldest', 
                        commit: { message: 'm', author: { name: 'A', date: 'd' } }, 
                        author: null, 
                    }],
                },
            }));

            const result = await fixture.call<{ commits: Array<{ sha: string }>; truncated: boolean }>('github_compare', {
                repo: 'octo/demo', 
                base: 'a', 
                head: 'b',
            });
            expect(fixture.fake.requests.at(-1)!.query).toMatchObject({ per_page: '100', page: '1' });
            expect(result.commits.map((commit) => commit.sha)).toEqual(['oldest']);
            expect(result.truncated).toBe(true);
        });

        it('reports a file list at GitHub\'s cap of 300 as truncated', async () => {
            const { call } = withComparison(2, 300);

            const result = await call<{ files: unknown[]; truncated: boolean }>('github_compare', {
                repo: 'octo/demo',
                base: 'a',
                head: 'b',
            });
            expect(result.files).toHaveLength(300);
            expect(result.truncated).toBe(true);
        });

        it('refuses refs that are no refs', async () => {
            const { call } = withComparison();

            await expect(call('github_compare', {
                repo: 'octo/demo',
                base: 'a...b',
                head: 'c',
            })).rejects.toBeInstanceOf(ValidationError);
            await expect(call('github_compare', {
                repo: 'octo/demo',
                base: 'a b',
                head: 'c',
            })).rejects.toBeInstanceOf(ValidationError);
        });
    });

    it('uses the configured installation for non-github runs', async () => {
        const { fake, call } = setup({ installationId: 7 }, { channel: 'cron' });
        fake.issues.set('octo/demo#5', { ...ISSUE });
        await call('github_get_issue', { repo: 'octo/demo', number: 5 });
        expect(fake.tokenInstallations).toEqual([7]);
    });

    it('uses the delivery installation for a run of a renamed github channel of the app', async () => {
        const fixture = createGithubFixture({ installationId: 7 });
        githubChannel({ app: fixture.gh, name: 'github-ent' });
        const event = {
            name: 'issues',
            action: 'opened',
            delivery: 'd-1',
            installationId: 42,
            payload: {},
        };
        const ctx = toolContext({ channel: 'github-ent', payload: event });
        const tools: ToolSet = wrapToolsForRun(fixture.gh.readTools(), ctx, new MemoryStore());
        fixture.fake.issues.set('octo/demo#5', { ...ISSUE });
        await callTool(tools, 'github_get_issue', { repo: 'octo/demo', number: 5 }, ctx);
        expect(fixture.fake.tokenInstallations).toEqual([42]);
    });

    it('never takes the installation from the payload of another channel', async () => {
        const { fake, call } = setup({ installationId: 7 }, {
            channel: 'http',
            payload: {
                name: 'issues',
                delivery: 'd-1',
                installationId: 42,
                payload: {},
            },
        });
        fake.issues.set('octo/demo#5', { ...ISSUE });
        await call('github_get_issue', { repo: 'octo/demo', number: 5 });
        expect(fake.tokenInstallations).toEqual([7]);
    });

    it('fails the run without an installation', async () => {
        const { call } = setup({}, { channel: 'http' });
        await expect(call('github_get_issue', { repo: 'octo/demo', number: 5 })).rejects.toBeInstanceOf(FatalToolError);
    });

    it('rejects a malformed repo as a tool error', async () => {
        const { call } = setup();
        for (const repo of ['octo', 'a/b/c', 'a /b']) {
            const error = await call('github_get_issue', { repo, number: 5 }).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).not.toBeInstanceOf(FatalToolError);
        }
        const error = await call('github_get_issue', { repo: 'octo/demo', number: 0 }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
    });

    it('aborts a pending GitHub request when the run signal aborts', async () => {
        const fixture = createGithubFixture();
        const started = Promise.withResolvers<void>();
        const gh = createGithubApp({
            appId: 123,
            privateKey: fixture.fake.privateKey,
            webhookSecret: WEBHOOK_SECRET,
            clock: fixture.clock,
            fetch: async (resource, init) => {
                const request = new Request(resource as RequestInfo, init);
                if (!new URL(request.url).pathname.startsWith('/repos/')) return fixture.fake.fetch(resource, init);
                if (!init?.signal) throw new TypeError('the request carries no signal');
                started.resolve();
                // a stalled GitHub: answers only by rejecting on abort
                return new Promise<Response>((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
                });
            },
        });
        const controller = new AbortController();
        const ctx = toolContext({ signal: controller.signal });
        const tools: ToolSet = wrapToolsForRun(gh.readTools(), ctx, new MemoryStore());
        const result = callTool(tools, 'github_get_issue', { repo: 'octo/demo', number: 5 }, ctx).catch((e: unknown) => e);
        await started.promise;
        controller.abort(new Error('drained'));
        const error = await result;
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(FatalToolError);
    });

    it('does not leak the token in errors', async () => {
        const {
            clock,
            fake,
            gh,
        } = createGithubFixture();
        const store = new MemoryStore({ clock });
        const agent = defineAgent({
            name: 'triage',
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'github_get_issue',
                        input: { repo: 'octo/demo', number: 99 },
                    }],
                },
                { parts: [{ type: 'text', text: 'no such issue' }] },
            ]),
            instructions: 'Triage.',
            channels: [github.on('issues.opened')],
            tools: () => gh.readTools(),
        });
        const engine = new Engine({
            store,
            agents: [agent],
            channels: [githubChannel({ app: gh, clock })],
            clock,
            onError: () => {},
        });
        const { runId } = await engine.dispatch({
            agent: 'triage',
            trigger: 'github:issues.opened',
            channel: 'github',
            payload: {
                name: 'issues',
                action: 'opened',
                delivery: 'd-1',
                installationId: 42,
                payload: {},
            },
        });
        await engine.start();
        await engine.idle();
        await engine.drain();

        expect((await store.getRun(runId))?.status).toBe('completed');
        expect(fake.requests.some((r) => r.path === '/repos/octo/demo/issues/99' && r.authorization === 'token ghs_1')).toBe(true);
        const steps = await store.listSteps(runId);
        const toolStep = steps.find((s) => s.kind === 'tool');
        expect(toolStep?.error).toMatchObject({ message: expect.stringContaining('GitHub 404') });
        const checkpoint = await store.latestCheckpoint(runId);
        const stored = JSON.stringify({ steps, checkpoint });
        expect(stored).not.toContain('ghs_');
        expect(stored.toLowerCase()).not.toContain('authorization');
    });
});
