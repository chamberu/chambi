/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { FakeGithub, FakeRouteResult } from './types.ts';

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
    if (body === undefined || status === 204) {
        return new Response(null, { status, headers });
    }

    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    });
}

export function compile(path: string): { pattern: RegExp; names: string[] } {
    const names: string[] = [];
    // ':name' is one segment, '*name' the rest of the path
    const source = path.replace(/([:*])([a-z_]+)/gi, (_match, kind: string, name: string) => {
        names.push(name);

        return kind === '*' ? '(.+)' : '([^/]+)';
    });

    return { pattern: new RegExp(`^${source}$`), names };
}

export function base64UrlJson(part: string): unknown {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

const NOT_FOUND: FakeRouteResult = { status: 404, body: { message: 'Not Found' } };

/** One page of `items` (`per_page`, `page`), with a `link` header to the next page. */
export function page(path: string, query: Record<string, string>, items: unknown[]): FakeRouteResult {
    const perPage = Number(query.per_page ?? 30);
    const current = Number(query.page ?? 1);
    const body = items.slice((current - 1) * perPage, current * perPage);

    if (current * perPage >= items.length) {
        return { status: 200, body };
    }

    const next = new URLSearchParams({ ...query, page: String(current + 1) });

    return {
        status: 200,
        body,
        headers: { link: `<https://api.github.com${path}?${next}>; rel="next"` },
    };
}

/** One page of `items` inside an object (`{ total_count, [key]: items }`), the `link` rule of `page()`. */
export function objectPage(path: string, query: Record<string, string>, key: string, items: unknown[]): FakeRouteResult {
    const result = page(path, query, items);

    return { ...result, body: { total_count: items.length, [key]: result.body } };
}

/** Issues, comments, labels, pulls, contents, releases, repositories, checks, statuses and branch protection backed by the fake's maps. */
export function addRepoRoutes(fake: FakeGithub, botLogin: string, clock: IClock): void {
    let nextCommentId = 9000;
    const issueKey = (p: Record<string, string>) => `${p.owner}/${p.repo}#${p.number}`;

    fake.route('GET', '/repos/:owner/:repo/issues/:number', ({ params }) => {
        const issue = fake.issues.get(issueKey(params));

        return issue ? { status: 200, body: issue } : NOT_FOUND;
    });
    fake.route('PATCH', '/repos/:owner/:repo/issues/:number', ({ params, body }) => {
        const issue = fake.issues.get(issueKey(params));

        if (!issue) {
            return NOT_FOUND;
        }

        Object.assign(issue, body as Record<string, unknown>);

        return { status: 200, body: issue };
    });
    fake.route('GET', '/repos/:owner/:repo/issues/:number/comments', ({ params, query }) => {
        const since = query.since ? Date.parse(query.since) : 0;
        const comments = (fake.comments.get(issueKey(params)) ?? [])
            .filter((c) => Date.parse(String(c.updated_at)) >= since);

        return page(`/repos/${params.owner}/${params.repo}/issues/${params.number}/comments`, query, comments);
    });
    fake.route('POST', '/repos/:owner/:repo/issues/:number/comments', ({ params, body }) => {
        const key = issueKey(params);

        if (!fake.issues.has(key)) {
            return NOT_FOUND;
        }

        const id = nextCommentId++;
        const now = clock.now().toISOString();
        const comment = {
            id,
            body: (body as { body: string }).body,
            html_url: `https://github.com/${params.owner}/${params.repo}/issues/${params.number}#issuecomment-${id}`,
            user: { login: botLogin, type: 'Bot' },
            created_at: now,
            updated_at: now,
        };

        fake.comments.set(key, [...(fake.comments.get(key) ?? []), comment]);

        return { status: 201, body: comment };
    });
    fake.route('PATCH', '/repos/:owner/:repo/issues/comments/:comment_id', ({ params, body }) => {
        for (const [key, comments] of fake.comments) {
            if (!key.startsWith(`${params.owner}/${params.repo}#`)) {
                continue;
            }

            const comment = comments.find((entry) => entry.id === Number(params.comment_id));

            if (comment) {
                comment.body = (body as { body: string }).body;
                comment.updated_at = clock.now().toISOString();

                return { status: 200, body: comment };
            }
        }

        return NOT_FOUND;
    });
    fake.route('POST', '/repos/:owner/:repo/issues/:number/labels', ({ params, body }) => {
        const issue = fake.issues.get(issueKey(params));

        if (!issue) {
            return NOT_FOUND;
        }

        const current = (issue.labels as Array<{ name: string }> | undefined) ?? [];
        const names = new Set([...current.map((l) => l.name), ...(body as { labels: string[] }).labels]);

        issue.labels = [...names].map((name) => ({ name }));

        return { status: 200, body: issue.labels };
    });
    fake.route('GET', '/repos/:owner/:repo/labels', ({ params, query }) => page(
        `/repos/${params.owner}/${params.repo}/labels`,
        query,
        fake.labels.get(`${params.owner}/${params.repo}`) ?? [],
    ));
    fake.route('GET', '/search/issues', ({ query }) => {
        const items = fake.issues.values().toArray().filter((i) => String(i.title).includes(query.q ?? ''));
        const perPage = Number(query.per_page ?? 30);

        return { status: 200, body: { total_count: items.length, items: items.slice(0, perPage) } };
    });
    fake.route('GET', '/repos/:owner/:repo/pulls/:number', ({ params }) => {
        const pull = fake.pulls.get(issueKey(params));

        return pull ? { status: 200, body: pull } : NOT_FOUND;
    });
    fake.route('GET', '/repos/:owner/:repo/contents/*path', ({ params }) => {
        const prefix = `${params.owner}/${params.repo}:`;
        const file = fake.files.get(`${prefix}${params.path}`);

        if (file) {
            return { status: 200, body: file };
        }

        const below = `${prefix}${params.path}/`;
        const entries = fake.files.entries().toArray()
            .filter(([key]) => key.startsWith(below) && !key.slice(below.length).includes('/'))
            .map(([, value]) => ({
                name: value.name,
                path: value.path,
                type: value.type,
            }));

        return entries.length > 0 ? { status: 200, body: entries } : NOT_FOUND;
    });
    fake.route('GET', '/repos/:owner/:repo/releases', ({ params, query }) => page(
        `/repos/${params.owner}/${params.repo}/releases`,
        query,
        (fake.releases.get(`${params.owner}/${params.repo}`) ?? []).toReversed(),
    ));
    fake.route('GET', '/repos/:owner/:repo/releases/latest', ({ params }) => {
        const release = fake.releases.get(`${params.owner}/${params.repo}`)?.at(-1);

        return release ? { status: 200, body: release } : NOT_FOUND;
    });

    const repoName = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
    const repositoryOf = (fullName: string): Record<string, unknown> => {
        const stored = fake.repositories.get(fullName) ??
            Array.from(fake.repositories.entries()).find(([key]) => key.toLowerCase() === fullName.toLowerCase())?.[1];

        if (stored) {
            return stored;
        }

        const [owner = '', name = ''] = fullName.split('/');

        return {
            full_name: fullName,
            name,
            owner: { login: owner },
            private: false,
            archived: false,
            fork: false,
            default_branch: 'main',
            html_url: `https://github.com/${fullName}`,
        };
    };
    const inRepo = <T>(map: Map<string, T>, name: string) => Array.from(map.entries())
        .filter(([key]) => key.startsWith(`${name}#`))
        .map(([, value]) => value);

    fake.route('GET', '/installation/repositories', ({ query, installationId }) => objectPage(
        '/installation/repositories',
        query,
        'repositories',
        Array.from(fake.installations.entries())
            .filter(([, id]) => id === installationId)
            .map(([name]) => repositoryOf(name)),
    ));
    fake.route('GET', '/repos/:owner/:repo', ({ params }) => ({ status: 200, body: repositoryOf(repoName(params)) }));
    fake.route('GET', '/repos/:owner/:repo/issues', ({ params, query }) => {
        const state = query.state ?? 'open';
        const since = query.since ? Date.parse(query.since) : 0;
        const issues = inRepo(fake.issues, repoName(params))
            .filter((i) => state === 'all' || (i.state ?? 'open') === state)
            .filter((i) => !query.creator || (i.user as { login?: string } | undefined)?.login === query.creator)
            .filter((i) => !since || Date.parse(String(i.updated_at)) >= since);

        return page(`/repos/${params.owner}/${params.repo}/issues`, query, issues);
    });

    const nextNumber = (name: string) => Math.max(0, ...[...inRepo(fake.issues, name), ...inRepo(fake.pulls, name)]
        .map((i) => Number(i.number) || 0)) + 1;

    fake.route('POST', '/repos/:owner/:repo/issues', ({ params, body }) => {
        const name = repoName(params);
        const input = body as {
            title: string;
            body?: string;
            labels?: string[]
        };
        const number = nextNumber(name);
        const now = clock.now().toISOString();
        const issue: Record<string, unknown> = {
            number,
            title: input.title,
            body: input.body ?? null,
            state: 'open',
            labels: (input.labels ?? []).map((label) => ({ name: label })),
            user: { login: botLogin, type: 'Bot' },
            comments: 0,
            created_at: now,
            updated_at: now,
            html_url: `https://github.com/${name}/issues/${number}`,
        };

        fake.issues.set(`${name}#${number}`, issue);

        return { status: 201, body: issue };
    });
    fake.route('GET', '/repos/:owner/:repo/pulls', ({ params, query }) => {
        const state = query.state ?? 'open';
        const pulls = inRepo(fake.pulls, repoName(params))
            .filter((p) => state === 'all' || (p.state ?? 'open') === state)
            .filter((p) => !query.head || (p.head as { label?: string } | undefined)?.label === query.head)
            .filter((p) => !query.base || (p.base as { ref?: string } | undefined)?.ref === query.base);

        return page(`/repos/${params.owner}/${params.repo}/pulls`, query, pulls);
    });
    fake.route('POST', '/repos/:owner/:repo/pulls', ({ params, body }) => {
        const name = repoName(params);
        const input = body as {
            title: string;
            body?: string;
            head: string;
            base: string;
            draft?: boolean
        };
        const split = input.head.indexOf(':');
        const headOwner = split === -1 ? params.owner! : input.head.slice(0, split);
        const ref = split === -1 ? input.head : input.head.slice(split + 1);
        const label = `${headOwner}:${ref}`;
        const exists = inRepo(fake.pulls, name).some((p) => p.state === 'open' &&
            (p.head as { label?: string } | undefined)?.label === label &&
            (p.base as { ref?: string } | undefined)?.ref === input.base);

        if (exists) {
            return { status: 422, body: { message: 'A pull request already exists' } };
        }

        const number = nextNumber(name);
        const now = clock.now().toISOString();
        const pull: Record<string, unknown> = {
            number,
            title: input.title,
            body: input.body ?? null,
            state: 'open',
            draft: input.draft ?? false,
            merged: false,
            mergeable: true,
            mergeable_state: 'clean',
            user: { login: botLogin, type: 'Bot' },
            head: {
                ref,
                label,
                sha: `sha-${ref}`,
                repo: { full_name: `${headOwner}/${params.repo}` },
            },
            base: { ref: input.base, repo: { full_name: name } },
            created_at: now,
            updated_at: now,
            html_url: `https://github.com/${name}/pull/${number}`,
        };

        fake.pulls.set(`${name}#${number}`, pull);

        return { status: 201, body: pull };
    });
    fake.route('PUT', '/repos/:owner/:repo/pulls/:number/merge', ({ params, body }) => {
        const pull = fake.pulls.get(issueKey(params));

        if (!pull) {
            return NOT_FOUND;
        }

        if (pull.merged === true || pull.mergeable === false) {
            return { status: 405, body: { message: 'Pull Request is not mergeable' } };
        }

        const input = (body ?? {}) as { sha?: string; merge_method?: string };
        const head = pull.head as { sha?: string } | undefined;

        if (input.sha !== undefined && input.sha !== head?.sha) {
            return { status: 409, body: { message: 'Head branch was modified. Review and try the merge again.' } };
        }

        const sha = `merge-${params.number}`;

        Object.assign(pull, {
            merged: true,
            state: 'closed',
            merge_commit_sha: sha,
            merge_method: input.merge_method ?? 'merge',
        });

        return {
            status: 200,
            body: {
                sha,
                merged: true,
                message: 'Pull Request successfully merged',
            },
        };
    });
    fake.route('GET', '/repos/:owner/:repo/commits/:ref/check-runs', ({ params, query }) => objectPage(
        `/repos/${params.owner}/${params.repo}/commits/${params.ref}/check-runs`,
        query,
        'check_runs',
        fake.checkRuns.get(`${repoName(params)}@${params.ref}`) ?? [],
    ));
    fake.route('GET', '/repos/:owner/:repo/commits/:ref/status', ({ params }) => {
        const statuses = fake.statuses.get(`${repoName(params)}@${params.ref}`) ?? [];
        const states = statuses.map((s) => s.state);
        let state = 'success';

        const hasFailure = states.some((s) => s === 'failure' || s === 'error');

        if (hasFailure) {
            state = 'failure';
        } else if (states.length === 0 || states.includes('pending')) {
            state = 'pending';
        }

        return {
            status: 200,
            body: {
                sha: params.ref,
                state,
                total_count: statuses.length,
                statuses,
            },
        };
    });
    fake.route('GET', '/repos/:owner/:repo/branches/:branch', ({ params }) => ({
        status: 200,
        body: fake.branches.get(`${repoName(params)}:${params.branch}`) ?? {
            name: params.branch,
            protected: false,
            protection: {
                enabled: false,
                required_status_checks: {
                    enforcement_level: 'off',
                    contexts: [],
                    checks: [],
                },
            },
        },
    }));
    fake.route('GET', '/repos/:owner/:repo/rules/branches/:branch', ({ params, query }) => page(
        `/repos/${params.owner}/${params.repo}/rules/branches/${params.branch}`,
        query,
        fake.rules.get(`${repoName(params)}:${params.branch}`) ?? [],
    ));
}

/** `promise`, or a rejection with the signal's reason once it aborts. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);

            return;
        }

        const onAbort = () => reject(signal.reason);

        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}
