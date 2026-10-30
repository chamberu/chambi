/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    InvalidAgentDefinitionError,
    ValidationError,
    createMemoryStore,
    effectMarker,
    wrapToolsForRun,
} from '@chamvi/core';
import type { ToolTrust } from '@chamvi/core';
import type { Tool } from 'ai';
import { createGithubApp } from '@chamvi/github';
import type { GithubCreatedPullRequest, GithubProposalsOptions, GithubProposeChangeInput } from '@chamvi/github';
import { githubModule } from '@chamvi/github/module';
import { createGithubFixture } from '../../utils/app.ts';
import { callTool, toolContext } from '../../utils/tools.ts';

const POLICY: GithubProposalsOptions = { repos: { 'octo/demo': { paths: ['config/**', 'README.md'] } } };
const INPUT: GithubProposeChangeInput = {
    repo: 'octo/demo',
    path: 'config/agent.yaml',
    content: 'enabled: true\n',
    reason: 'Enable the agent.',
};

/** Immutable Git objects and non-forced refs, isolated from the shared GitHub fake. */
function setup(policy = POLICY) {
    const fixture = createGithubFixture({ proposals: policy });
    const { fake, gh } = fixture;

    fake.installations.set('octo/demo', 9);

    type File = { content: string; mode: string };
    type Commit = {
        tree: string;
        message: string;
        parents: string[]
    };
    const refs = new Map([['heads/main', 'base-sha']]);
    const trees = new Map<string, Map<string, File>>([['base-tree', new Map()]]);
    const history = new Map<string, Commit>([['base-sha', {
        tree: 'base-tree',
        message: 'Initial',
        parents: [],
    }]]);
    const pulls: Array<Record<string, any>> = [];
    let pull: Record<string, any> | undefined;
    let commits = 0;
    let posts = 0;
    let patches = 0;
    let updates = 0;
    let failPatch = false;
    let failCreate = false;
    let diffFiles: Array<{ filename: string; previous_filename?: string }> | undefined;
    let onCompare: (() => void) | undefined;
    let onUpdate: (() => void) | undefined;
    let onPublish: (() => void) | undefined;
    let treeTruncated = false;

    const ancestors = (sha: string): Array<{ sha: string; commit: { message: string } }> => {
        const commit = history.get(sha)!;

        return [{ sha, commit: { message: commit.message } }, ...commit.parents.flatMap(ancestors)];
    };
    const filesAt = (sha: string) => trees.get(history.get(sha)!.tree)!;
    const branchFiles = () => {
        const branch = pull?.head.ref ?? Array.from(refs.keys()).find((ref) => ref !== 'heads/main')?.slice(6);

        return filesAt(refs.get(`heads/${branch}`) ?? refs.get('heads/main')!);
    };

    fake.route('GET', '/repos/:owner/:repo/pulls/:number/commits', ({ params, query }) => {
        const proposal = pulls.find((item) => item.number === Number(params.number))!;
        const head = proposal.state === 'open' ? refs.get(`heads/${proposal.head.ref}`)! : proposal.head.sha;
        const all = ancestors(head).filter((item) => item.sha !== 'base-sha' && !item.sha.startsWith('old-')).reverse().slice(0, 250);
        const page = Number(query.page ?? 1);
        const perPage = Number(query.per_page ?? 100);

        return {
            status: 200,
            body: all.slice((page - 1) * perPage, page * perPage),
            headers: all.length > page * perPage ? { link: `<https://github.test/repos/octo/demo/pulls/${params.number}/commits?per_page=${perPage}&page=${page + 1}>; rel="next"` } : undefined,
        };
    });
    fake.route('GET', '/repos/:owner/:repo/git/commits/:sha', ({ params }) => {
        const commit = history.get(params.sha!)!;

        return {
            status: 200,
            body: {
                sha: params.sha,
                message: commit.message,
                tree: { sha: commit.tree },
                parents: commit.parents.map((sha) => ({ sha })),
            },
        };
    });
    fake.route('GET', '/repos/:owner/:repo/git/trees/*tree', ({ params }) => {
        const [root, prefix = ''] = params.tree!.split(':');
        const entries = new Map<string, {
            path: string;
            mode: string;
            type: string;
            sha: string
        }>();

        for (const [path, file] of trees.get(root!)!) {
            if (!path.startsWith(prefix)) {
                continue;
            }

            const rest = path.slice(prefix.length);
            const part = rest.split('/')[0]!;
            const directory = rest.includes('/');

            const fileType = file.mode === '160000' ? 'commit' : 'blob';

            entries.set(part, {
                path: part,
                mode: directory ? '040000' : file.mode,
                type: directory ? 'tree' : fileType,
                sha: directory ? `${root}:${prefix}${part}/` : `${root}:${path}`,
            });
        }

        return { status: 200, body: { truncated: treeTruncated, tree: Array.from(entries.values()) } };
    });
    fake.route('GET', '/repos/:owner/:repo/git/blobs/*sha', ({ params }) => {
        const [tree, path] = params.sha!.split(':');

        return { status: 200, body: { encoding: 'base64', content: Buffer.from(trees.get(tree!)!.get(path!)!.content).toString('base64') } };
    });
    fake.route('POST', '/repos/:owner/:repo/git/trees', ({ body }) => {
        const input = body as {
            base_tree: string;
            tree: Array<{
                path: string;
                content: string;
                mode: string
            }>
        };
        const tree = new Map(trees.get(input.base_tree)!);

        for (const file of input.tree) {
            tree.set(file.path, { content: file.content, mode: file.mode });
        }

        const sha = `tree-${trees.size}`;

        trees.set(sha, tree);

        return { status: 201, body: { sha } };
    });
    fake.route('POST', '/repos/:owner/:repo/git/commits', ({ body }) => {
        commits += 1;
        history.set(`commit-${commits}`, body as Commit);

        return { status: 201, body: { sha: `commit-${commits}` } };
    });
    fake.route('GET', '/repos/:owner/:repo/compare/*basehead', ({ params }) => {
        const [base, head] = params.basehead!.split('...');
        const before = filesAt(base!);
        const after = filesAt(head!);
        const changed = new Set([...before.keys(), ...after.keys()]);
        const files = Array.from(changed).filter((path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
            .map((filename) => ({ filename }));
        const baseAncestors = new Set(ancestors(base!).map((commit) => commit.sha));
        const result = {
            merge_base_commit: ancestors(head!).find((commit) => baseAncestors.has(commit.sha)),
            files: diffFiles ?? files,
            ahead_by: head === base ? 0 : ancestors(head!).length - ancestors(base!).length,
            status: head === base ? 'identical' : 'ahead',
        };

        onCompare?.();

        return { status: 200, body: result };
    });
    fake.route('GET', '/repos/:owner/:repo', () => ({ status: 200, body: { default_branch: 'main' } }));
    fake.route('GET', '/repos/:owner/:repo/git/ref/*ref', ({ params }) => refs.has(params.ref!) ?
        { status: 200, body: { object: { sha: refs.get(params.ref!) } } } :
        { status: 404 });
    fake.route('POST', '/repos/:owner/:repo/git/refs', ({ body }) => {
        const input = body as { ref: string; sha: string };
        const ref = input.ref.replace('refs/', '');

        if (refs.has(ref)) {
            return { status: 422 };
        }

        refs.set(ref, input.sha);

        return { status: 201, body: {} };
    });
    fake.route('PATCH', '/repos/:owner/:repo/git/refs/*ref', ({ params, body }) => {
        const input = body as { sha: string; force: boolean };

        onUpdate?.();
        expect(input.force).toBe(false);

        const fastForward = ancestors(input.sha).some((commit) => commit.sha === refs.get(params.ref!));

        if (!fastForward) {
            return { status: 422, body: { message: 'Not a fast forward' } };
        }

        updates += 1;
        refs.set(params.ref!, input.sha);

        return { status: 200, body: {} };
    });
    fake.route('GET', '/repos/:owner/:repo/pulls', ({ query }) => {
        const page = Number(query.page ?? 1);
        const start = (page - 1) * 100;

        return {
            status: 200,
            body: pulls.slice(start, start + 100).map((item) => ({
                ...item,
                head: { ...item.head, sha: item.state === 'open' ? refs.get(`heads/${item.head.ref}`) : item.head.sha },
            })),
            headers: pulls.length > start + 100 ? { link: `<https://github.test/repos/octo/demo/pulls?state=all&per_page=100&page=${page + 1}>; rel="next"` } : undefined,
        };
    });
    fake.route('POST', '/repos/:owner/:repo/pulls', ({ body }) => {
        posts += 1;

        if (failCreate) {
            failCreate = false;

            return { status: 503 };
        }

        const input = body as {
            head: string;
            base: string;
            title: string;
            body: string
        };

        pull = {
            number: 12 + pulls.length,
            html_url: `https://github.test/octo/demo/pull/${12 + pulls.length}`,
            state: 'open',
            head: {
                ref: input.head,
                sha: refs.get(`heads/${input.head}`),
                label: `octo:${input.head}`,
                repo: { full_name: 'octo/demo' },
            },
            base: { ref: input.base },
            body: input.body,
            title: input.title,
        };
        pulls.push(pull);
        onPublish?.();

        return { status: 201, body: pull };
    });
    fake.route('PATCH', '/repos/:owner/:repo/pulls/:number', ({ body }) => {
        patches += 1;

        if (failPatch) {
            failPatch = false;

            return { status: 503 };
        }

        Object.assign(pull!, body);
        pull!.head.sha = refs.get(`heads/${pull!.head.ref}`);
        onPublish?.();

        return { status: 200, body: pull };
    });

    const call = (input = INPUT, runId = 'r1') => callTool<GithubCreatedPullRequest>(gh.writeTools(), 'github_propose_change', input, toolContext({ runId }));

    return {
        ...fixture,
        call,
        refs,
        history,
        trees,
        pulls,
        branchFiles,
        failNextPatch: () => {
            failPatch = true;
        },
        failNextCreate: () => {
            failCreate = true;
        },
        setDiff: (value: typeof diffFiles) => {
            diffFiles = value;
        },
        onCompare: (callback: () => void) => {
            onCompare = callback;
        },
        onUpdate: (callback: () => void) => {
            onUpdate = callback;
        },
        onPublish: (callback: () => void) => {
            onPublish = callback;
        },
        truncateTree: () => {
            treeTruncated = true;
        },
        close: (merged = false, removeBranch = false) => {
            pull!.state = 'closed';
            pull!.head.sha = refs.get(`heads/${pull!.head.ref}`);

            if (merged) {
                refs.set('heads/main', pull!.head.sha);
            }

            if (removeBranch) {
                refs.delete(`heads/${pull!.head.ref}`);
            }
        },
        current: () => ({
            pull,
            commits,
            posts,
            patches,
            updates,
        }),
    };
}

function wrapped(fixture: ReturnType<typeof setup>, runId: string, store = createMemoryStore().effects) {
    return wrapToolsForRun(fixture.gh.writeTools(), toolContext({ runId }), store).github_propose_change!;
}

function replay(fixture: ReturnType<typeof setup>, runId: string, input = INPUT) {
    return callTool<GithubCreatedPullRequest>({ propose: wrapped(fixture, runId) }, 'propose', input, toolContext({ runId }));
}

describe('github_propose_change', () => {
    it('is opt-in, only in write tools and always outbound', () => {
        const { gh: plain } = createGithubFixture();
        const { gh } = setup();

        expect(plain.writeTools()).not.toHaveProperty('github_propose_change');
        expect(gh.readTools()).not.toHaveProperty('github_propose_change');
        expect((gh.writeTools().github_propose_change as Tool & { trust: ToolTrust }).trust).toEqual({ guardWhenTainted: true });
    });

    it('is contributed through githubModule write tools', async () => {
        const { gh } = setup();
        const module = githubModule({ app: gh });

        expect(module.app.writeTools()).toHaveProperty('github_propose_change');
    });

    it.each([
        '/config/a',
        '../config/a',
        'config/../a',
        'config/./a',
        'config//a',
        'config/a/',
        'config\\a',
        'config/%2e%2e/a',
        'config/a\0',
        '.github/workflows/a',
        '.GITHUB/a',
        'config/a?b',
        'other/a',
        '',
    ])('rejects path %j before any requests', async (path) => {
        const { call, fake } = setup();

        await expect(call({ ...INPUT, path })).rejects.toThrow(ValidationError);
        expect(fake.requests).toEqual([]);
    });

    it('rejects unlisted repos and invalid input before requests', async () => {
        const { call, fake } = setup();

        for (const input of [{ ...INPUT, repo: 'octo/other' }, { ...INPUT, reason: '' }, { ...INPUT, content: 1 }]) {
            await expect(call(input as GithubProposeChangeInput)).rejects.toThrow(ValidationError);
        }

        expect(fake.requests).toEqual([]);
    });

    it('validates policy eagerly', () => {
        const { fake } = createGithubFixture();

        for (const policy of [null, { repos: [] }, { repos: { invalid: { paths: ['*'] } } }, { repos: { 'octo/demo': { paths: [] } } }, { repos: { 'octo/demo': { paths: ['../*'] } } }, { repos: { 'octo/demo': { paths: ['.github/**'] } } }, { repos: { 'octo/demo': { paths: ['config\\*'] } } }, { repos: { 'octo/demo': { paths: [1] } } }]) {
            expect(() => createGithubApp({
                appId: 123,
                privateKey: fake.privateKey,
                webhookSecret: 'test-secret',
                fetch: fake.fetch,
                proposals: policy as unknown as GithubProposalsOptions,
            })).toThrow(InvalidAgentDefinitionError);
        }
    });

    it('copies the policy and creates a pinned, allowlisted commit from the default branch', async () => {
        const policy = { repos: { 'octo/demo': { paths: ['config/**'] } } };
        const fixture = setup(policy);

        policy.repos['octo/demo'].paths[0] = '**';
        await expect(fixture.call({ ...INPUT, path: 'other/a' })).rejects.toThrow(ValidationError);

        const result = await fixture.call();

        expect(result).toMatchObject({ number: 12, base: 'main' });
        expect(result.head).toMatch(/^octo:chamvi\/triage\/config-agent-yaml-[a-f0-9]+$/);
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe(INPUT.content);
        expect(fixture.history.get('commit-1')?.parents).toEqual(['base-sha']);
        expect(fixture.history.get('commit-1')?.message).toContain(effectMarker('r1:propose:octo/demo:config/agent.yaml'));
        expect(fixture.current()).toMatchObject({
            commits: 1,
            posts: 1,
            patches: 0,
            updates: 1,
        });
        expect(fixture.fake.requests.filter((request) => request.path.includes('/compare/')).every((request) => !request.path.includes('chamvi'))).toBe(true);
        expect(fixture.fake.requests.some((request) => request.method === 'PUT' || request.path.includes('/contents/'))).toBe(false);
    });

    it('hashes the full path when truncated slugs match', async () => {
        const { call } = setup();
        const prefix = `config/${'a'.repeat(100)}`;
        const one = await call({ ...INPUT, path: `${prefix}/first` });
        const two = await call({ ...INPUT, path: `${prefix}/second` }, 'r2');

        expect(one.head).not.toBe(two.head);
    });

    it('reuses an open PR across runs and keeps a fixed effect within one run', async () => {
        const fixture = setup();
        const tool = wrapped(fixture, 'r1');
        const ctx = toolContext({ runId: 'r1' });
        const first = await callTool({ propose: tool }, 'propose', INPUT, ctx);
        const same = await callTool({ propose: tool }, 'propose', { ...INPUT, content: 'ignored' }, ctx);
        const later = await replay(fixture, 'r2', { ...INPUT, content: 'later' });

        expect(same).toEqual(first);
        expect(later.number).toBe(12);
        expect(fixture.current()).toMatchObject({
            commits: 2,
            posts: 1,
            patches: 1,
        });
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe('later');
    });

    it('recovers a lost effect record from ancestry after another run replaces the body and tip', async () => {
        const fixture = setup();
        const first = await replay(fixture, 'r1');

        await replay(fixture, 'r2', { ...INPUT, content: 'newer' });
        expect(fixture.current().pull?.body).not.toContain(effectMarker('r1:propose:octo/demo:config/agent.yaml'));

        const before = fixture.current();

        expect(await replay(fixture, 'r1')).toEqual(first);
        expect(fixture.current()).toEqual(before);
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe('newer');
    });

    it('records unchanged open-PR proposals so they cannot overwrite a later run on replay', async () => {
        const fixture = setup();

        await replay(fixture, 'r1');
        await replay(fixture, 'r2');
        await replay(fixture, 'r3', { ...INPUT, content: 'latest' });

        const before = fixture.current();

        await replay(fixture, 'r2');
        expect(fixture.current()).toEqual(before);
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe('latest');
    });

    it('finishes publication without another commit after create or patch failure', async () => {
        const fixture = setup();

        fixture.failNextCreate();
        await expect(replay(fixture, 'r1')).rejects.toThrow();
        expect(fixture.current()).toMatchObject({ commits: 1, posts: 1 });
        await replay(fixture, 'r1');
        expect(fixture.current()).toMatchObject({ commits: 1, posts: 2 });

        fixture.failNextPatch();
        await expect(replay(fixture, 'r2', { ...INPUT, content: 'second' })).rejects.toThrow();
        await replay(fixture, 'r2', { ...INPUT, content: 'second' });
        expect(fixture.current()).toMatchObject({
            commits: 2,
            posts: 2,
            patches: 1,
        });
    });

    it.each([
        { merged: false, removeBranch: false },
        { merged: false, removeBranch: true },
        { merged: true, removeBranch: false },
        { merged: true, removeBranch: true },
    ])('starts a fresh generation after closure ($merged), retaining or deleting the branch ($removeBranch)', async ({ merged, removeBranch }) => {
        const fixture = setup();
        const first = await replay(fixture, 'r1');

        fixture.close(merged, removeBranch);

        const second = await replay(fixture, 'r2', { ...INPUT, content: 'second' });

        expect(second.number).not.toBe(first.number);
        expect(second.head).toMatch(/-g-12$/);
        expect(fixture.history.get('commit-2')?.parents).toEqual([merged ? 'commit-1' : 'base-sha']);

        const before = fixture.current();

        expect(await replay(fixture, 'r1')).toEqual(first);
        expect(fixture.current()).toEqual(before);
    });

    it('rejects an identical proposal after merge instead of creating an empty PR', async () => {
        const fixture = setup();

        await replay(fixture, 'r1');
        fixture.close(true);
        await expect(replay(fixture, 'r2')).rejects.toThrow('already matches the base');
        expect(fixture.current()).toMatchObject({ commits: 1, posts: 1 });
    });

    it('does not reconcile markers belonging to another proposal branch', async () => {
        const fixture = setup();

        await replay(fixture, 'r1');

        const commit = fixture.history.get('commit-1')!;

        commit.message = commit.message.replace(/chamvi:proposal=[^ ]+ -->/, 'chamvi:proposal=unrelated -->');
        await replay(fixture, 'r2', { ...INPUT, content: 'newer' });
        await replay(fixture, 'r1');
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe(INPUT.content);
        expect(fixture.current().commits).toBe(3);
    });

    it('recovers a failed publication on a fresh generation without another commit', async () => {
        const fixture = setup();

        await replay(fixture, 'r1');
        fixture.close(true);
        fixture.failNextCreate();
        await expect(replay(fixture, 'r2', { ...INPUT, content: 'second' })).rejects.toThrow();
        await replay(fixture, 'r2', { ...INPUT, content: 'second' });
        expect(fixture.current()).toMatchObject({ commits: 2, posts: 3 });
    });

    it('reconciles an orphaned generation after another run finishes its PR', async () => {
        const fixture = setup();

        await replay(fixture, 'r1');
        fixture.close(true);
        fixture.failNextCreate();
        await expect(replay(fixture, 'r2', { ...INPUT, content: 'second' })).rejects.toThrow();

        const later = await replay(fixture, 'r3', { ...INPUT, content: 'latest' });
        const before = fixture.current();

        expect(await replay(fixture, 'r2', { ...INPUT, content: 'second' })).toEqual(later);
        expect(fixture.current()).toEqual(before);
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe('latest');
        expect(fixture.pulls).toHaveLength(2);
    });

    it('recovers an unpublished branch after the base advances independently', async () => {
        const fixture = setup();

        fixture.failNextCreate();
        await expect(replay(fixture, 'r1')).rejects.toThrow();
        fixture.history.set('advanced-base', {
            ...fixture.history.get('base-sha')!,
            message: 'Independent base commit',
            parents: ['base-sha'],
        });
        fixture.refs.set('heads/main', 'advanced-base');

        const recovered = await replay(fixture, 'r2', { ...INPUT, content: 'later' });

        expect(fixture.current()).toMatchObject({ commits: 2, posts: 2 });
        expect(fixture.branchFiles().get(INPUT.path)?.content).toBe('later');
        expect(await replay(fixture, 'r1')).toMatchObject({ number: recovered.number });
        expect(fixture.current()).toMatchObject({ commits: 2, posts: 2 });
    });

    it('does not publish an orphaned marker commit after its content reaches the base', async () => {
        const fixture = setup();

        fixture.failNextCreate();
        await expect(replay(fixture, 'r1')).rejects.toThrow();
        fixture.history.set('external-base', {
            tree: 'tree-1',
            message: 'Applied independently',
            parents: ['base-sha'],
        });
        fixture.refs.set('heads/main', 'external-base');
        await expect(replay(fixture, 'r1')).rejects.toThrow('already matches the base');
        expect(fixture.current()).toMatchObject({ commits: 1, posts: 1 });
    });

    it('rejects a no-op against the base instead of attempting a no-diff PR', async () => {
        const fixture = setup();

        fixture.trees.get('base-tree')!.set(INPUT.path, { content: INPUT.content, mode: '100644' });
        await expect(fixture.call()).rejects.toThrow('already matches the base');
        expect(fixture.current()).toMatchObject({ commits: 0, posts: 0 });
    });

    it.each(['120000', '160000'])('rejects non-regular mode %s, even when content already matches', async (mode) => {
        const fixture = setup();

        fixture.trees.get('base-tree')!.set(INPUT.path, { content: INPUT.content, mode });
        await expect(fixture.call()).rejects.toThrow('regular file');
        expect(fixture.current()).toMatchObject({ commits: 0, posts: 0 });
    });

    it.each(['120000', '160000'])('rejects a parent with mode %s rather than traversing it', async (mode) => {
        const fixture = setup();

        fixture.trees.get('base-tree')!.set('config', { content: 'elsewhere', mode });
        await expect(fixture.call()).rejects.toThrow('parent must be a directory');
        expect(fixture.current().updates).toBe(0);
    });

    it('preserves executable mode and rejects truncated tree listings', async () => {
        const fixture = setup();

        fixture.trees.get('base-tree')!.set(INPUT.path, { content: 'old', mode: '100755' });
        await fixture.call();
        expect(fixture.branchFiles().get(INPUT.path)?.mode).toBe('100755');
        fixture.truncateTree();
        await expect(fixture.call({ ...INPUT, content: 'new' }, 'r2')).rejects.toThrow('tree is truncated');
    });

    it.each([
        { files: [{ filename: 'private/data' }] },
        { files: [{ filename: '.github/workflows/agent.yml' }] },
        { files: [{ filename: INPUT.path, previous_filename: 'private/credentials' }] },
        { files: Array.from({ length: 300 }, (_, index) => ({ filename: `config/${index}` })) },
    ])('rejects disallowed, renamed or capped diffs', async ({ files }) => {
        const fixture = setup();

        fixture.setDiff(files);
        await expect(fixture.call()).rejects.toThrow('branch diff');
        expect(fixture.current()).toMatchObject({ commits: 0, posts: 0 });
    });

    it('does not scan default history for a fresh branch or an absent effect', async () => {
        const fixture = setup();

        for (let index = 0; index < 500; index += 1) {
            fixture.history.set(`old-${index}`, {
                tree: 'base-tree',
                message: 'Default history',
                parents: index === 0 ? [] : [`old-${index - 1}`],
            });
        }

        fixture.history.get('base-sha')!.parents = ['old-499'];
        await replay(fixture, 'r1');
        await replay(fixture, 'r2', { ...INPUT, content: 'next' });

        expect(fixture.fake.requests.some((request) => request.method === 'GET' && request.path === '/repos/octo/demo/commits')).toBe(false);
        expect(fixture.fake.requests.some((request) => request.path.includes('/git/commits/old-'))).toBe(false);
        expect(fixture.current().commits).toBe(2);
    });

    it('replays historical markers when the merged base equals the deleted PR head', async () => {
        const fixture = setup();
        const first = await replay(fixture, 'r1');

        await replay(fixture, 'r2', { ...INPUT, content: 'later' });

        const branch = fixture.current().pull!.head.ref;
        const head = fixture.refs.get(`heads/${branch}`)!;

        fixture.close(true, true);
        fixture.current().pull!.base.sha = head;
        expect(await replay(fixture, 'r1')).toEqual(first);
        expect(fixture.current().commits).toBe(2);
    });

    it('fails closed before publication when proposal history reaches the reconciliation limit', async () => {
        const fixture = setup();

        await fixture.call();

        const branch = fixture.current().pull!.head.ref;
        let parent = fixture.refs.get(`heads/${branch}`)!;

        for (let index = 0; index < 250; index += 1) {
            const sha = `owned-${index}`;

            fixture.history.set(sha, {
                tree: fixture.history.get(parent)!.tree,
                message: `Other run\n<!-- chamvi:proposal=${branch} -->`,
                parents: [parent],
            });
            parent = sha;
        }

        fixture.refs.set(`heads/${branch}`, parent);

        const before = fixture.fake.requests.length;

        await expect(replay(fixture, 'new-run')).rejects.toThrow(/history limit/);
        expect(fixture.fake.requests.slice(before).filter((request) => request.path.endsWith('/pulls/12/commits'))).toHaveLength(3);
        expect(fixture.current()).toMatchObject({
            commits: 1,
            posts: 1,
            patches: 0,
        });
    });

    it('returns a marker match without reading later history pages', async () => {
        const fixture = setup();

        await fixture.call();

        const branch = fixture.current().pull!.head.ref;
        let parent = 'commit-1';

        for (let index = 0; index < 250; index += 1) {
            const sha = `owned-${index}`;

            fixture.history.set(sha, {
                tree: fixture.history.get(parent)!.tree,
                message: `Other run\n<!-- chamvi:proposal=${branch} -->`,
                parents: [parent],
            });
            parent = sha;
        }

        fixture.refs.set(`heads/${branch}`, parent);

        const before = fixture.fake.requests.length;

        expect(await replay(fixture, 'r1')).toMatchObject({ number: 12 });
        expect(fixture.fake.requests.slice(before).filter((request) => request.path.endsWith('/pulls/12/commits'))).toHaveLength(1);
        expect(fixture.current()).toMatchObject({
            commits: 1,
            posts: 1,
            patches: 0,
        });
    });

    it('keeps historical generations independent instead of sharing a lifetime budget', async () => {
        const fixture = setup();

        for (let index = 0; index < 3; index += 1) {
            await replay(fixture, `generation-${index}`);

            const branch = fixture.current().pull!.head.ref;
            let parent = fixture.refs.get(`heads/${branch}`)!;

            for (let commit = 0; commit < 100; commit += 1) {
                const sha = `generation-${index}-${commit}`;

                fixture.history.set(sha, {
                    tree: fixture.history.get(parent)!.tree,
                    message: `Other run\n<!-- chamvi:proposal=${branch} -->`,
                    parents: [parent],
                });
                parent = sha;
            }

            fixture.refs.set(`heads/${branch}`, parent);
            Object.assign(fixture.current().pull!.head, { sha: parent });
            Object.assign(fixture.current().pull!, { state: 'closed' });
            fixture.refs.delete(`heads/${branch}`);
        }

        expect(await replay(fixture, 'new-generation')).toMatchObject({ number: 15 });
        expect(await replay(fixture, 'generation-0')).toMatchObject({ number: 12 });
        expect(fixture.current()).toMatchObject({ commits: 4, posts: 4 });
    });

    it('refuses another commit at capacity but permits replay and a fresh generation after closure', async () => {
        const fixture = setup();

        await fixture.call();

        const branch = fixture.current().pull!.head.ref;
        let parent = 'commit-1';

        for (let index = 0; index < 248; index += 1) {
            const sha = `owned-${index}`;

            fixture.history.set(sha, {
                tree: fixture.history.get(parent)!.tree,
                message: `Other run\n<!-- chamvi:proposal=${branch} -->`,
                parents: [parent],
            });
            parent = sha;
        }

        fixture.refs.set(`heads/${branch}`, parent);
        await expect(replay(fixture, 'r2')).rejects.toThrow(/close or merge/);
        expect(await replay(fixture, 'r1')).toMatchObject({ number: 12 });
        expect(fixture.current()).toMatchObject({
            commits: 1,
            posts: 1,
            patches: 0,
        });
        Object.assign(fixture.current().pull!.head, { sha: parent });
        Object.assign(fixture.current().pull!, { state: 'closed' });
        fixture.refs.delete(`heads/${branch}`);
        expect(await replay(fixture, 'r2')).toMatchObject({ number: 13 });
        expect(fixture.current()).toMatchObject({ commits: 2, posts: 2 });
    });

    it('retains historical effects behind an unmarked commit on a PR', async () => {
        const fixture = setup();

        await fixture.call();

        const branch = fixture.current().pull!.head.ref;
        const commit = fixture.history.get('commit-1')!;

        fixture.history.set('merge', {
            tree: commit.tree,
            message: 'Manual update',
            parents: ['commit-1'],
        });
        fixture.refs.set(`heads/${branch}`, 'merge');
        expect(await replay(fixture, 'r1')).toMatchObject({ number: 12 });
        expect(fixture.current().commits).toBe(1);
    });

    it('fails closed on an unmarked orphan ancestor rather than replaying an older effect', async () => {
        const fixture = setup();

        fixture.failNextCreate();
        await expect(replay(fixture, 'r1')).rejects.toThrow();

        const branch = Array.from(fixture.refs.keys()).find((ref) => ref !== 'heads/main')!;
        const commit = fixture.history.get('commit-1')!;

        fixture.history.set('manual', {
            tree: commit.tree,
            message: 'Manual update',
            parents: ['commit-1'],
        });
        fixture.history.set('owned', {
            tree: commit.tree,
            message: `Later tool update\n<!-- chamvi:proposal=${branch.slice(6)} -->`,
            parents: ['manual'],
        });
        fixture.refs.set(branch, 'owned');
        await expect(replay(fixture, 'r1')).rejects.toThrow(/ancestry is not proposal-owned/);
        expect(fixture.current()).toMatchObject({ commits: 1, posts: 1 });
    });

    it('fails closed on incomplete PR discovery rather than creating another generation', async () => {
        const fixture = setup();

        await fixture.call();

        for (let index = 0; index < 1000; index += 1) {
            fixture.pulls.unshift({
                number: 100 + index,
                state: 'closed',
                head: { ref: `unrelated-${index}`, repo: { full_name: 'octo/demo' } },
            });
        }

        const before = fixture.fake.requests.length;

        await expect(replay(fixture, 'r2')).rejects.toThrow(/PR discovery limit/);
        expect(fixture.fake.requests.slice(before).filter((request) => request.path.endsWith('/pulls'))).toHaveLength(10);
        expect(fixture.current()).toMatchObject({
            commits: 1,
            posts: 1,
            patches: 0,
        });
    });

    it('rejects missing diff data', async () => {
        const fixture = setup();

        fixture.fake.route('GET', '/repos/:owner/:repo/compare/*basehead', () => ({ status: 200, body: { status: 'ahead', ahead_by: 1 } }));
        await expect(fixture.call()).rejects.toThrow('branch diff');
    });

    it('rejects unrelated branches and unmarked PRs', async () => {
        const fixture = setup();

        await fixture.call();
        fixture.current().pull!.body = 'Unrelated';
        await expect(replay(fixture, 'r2')).rejects.toThrow('not proposal-owned');
        fixture.pulls.length = 0;
        fixture.history.get('commit-1')!.message = 'Unrelated';
        await expect(fixture.call(INPUT, 'r2')).rejects.toThrow('not proposal-owned');
    });

    it('finds proposal PRs and effects beyond the first pagination page', async () => {
        const fixture = setup();
        const first = await replay(fixture, 'r1');
        const proposal = fixture.pulls.pop()!;

        for (let index = 0; index < 100; index += 1) {
            fixture.pulls.push({
                ...proposal,
                number: 100 + index,
                head: { ...proposal.head, ref: `unrelated-${index}` },
            });
        }

        fixture.pulls.push(proposal);

        let parent = 'commit-1';

        for (let index = 0; index < 101; index += 1) {
            const sha = `later-${index}`;

            fixture.history.set(sha, {
                tree: 'tree-1',
                message: 'Later commit',
                parents: [parent],
            });
            parent = sha;
        }

        fixture.history.get('commit-1')!.message = 'Earlier commit';
        fixture.history.get(parent)!.message = `Later proposal\n<!-- chamvi:proposal=${proposal.head.ref} -->\n${effectMarker('r1:propose:octo/demo:config/agent.yaml')}`;
        fixture.refs.set(`heads/${proposal.head.ref}`, parent);
        expect(await replay(fixture, 'r1')).toEqual(first);
        expect(fixture.fake.requests.some((request) => request.query.page === '2')).toBe(true);
    });

    it.each(['compare', 'update', 'publish', 'base'])('fails closed when a ref moves during %s', async (phase) => {
        const fixture = setup();
        const move = () => {
            const ref = phase === 'base' ? 'heads/main' : Array.from(fixture.refs.keys()).find((key) => key !== 'heads/main')!;
            const parent = fixture.refs.get(ref)!;

            fixture.history.set('concurrent', {
                tree: 'base-tree',
                message: 'Concurrent',
                parents: [parent],
            });
            fixture.refs.set(ref, 'concurrent');
        };

        if (phase === 'compare') {
            fixture.onCompare(move);
        } else if (phase === 'update') {
            fixture.onUpdate(move);
        } else if (phase === 'publish') {
            fixture.onPublish(move);
        } else {
            fixture.onCompare(move);
        }

        await expect(fixture.call()).rejects.toThrow();
        expect(fixture.current().posts).toBe(phase === 'publish' ? 1 : 0);

        if (phase === 'update') {
            expect(fixture.current().updates).toBe(0);
        }
    });
});
