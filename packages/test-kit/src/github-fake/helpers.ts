/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { FakeGithub, FakeRouteResult } from './types.ts';

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
    if (body === undefined || status === 204) return new Response(null, { status, headers });
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
    if (current * perPage >= items.length) return { status: 200, body };
    const next = new URLSearchParams({ ...query, page: String(current + 1) });
    return {
        status: 200,
        body,
        headers: { link: `<https://api.github.com${path}?${next}>; rel="next"` },
    };
}

/** Issues, comments, labels, pulls, contents and releases backed by the fake's maps. */
export function addRepoRoutes(fake: FakeGithub, botLogin: string, clock: IClock): void {
    let nextCommentId = 9000;
    const issueKey = (p: Record<string, string>) => `${p.owner}/${p.repo}#${p.number}`;

    fake.route('GET', '/repos/:owner/:repo/issues/:number', ({ params }) => {
        const issue = fake.issues.get(issueKey(params));
        return issue ? { status: 200, body: issue } : NOT_FOUND;
    });
    fake.route('PATCH', '/repos/:owner/:repo/issues/:number', ({ params, body }) => {
        const issue = fake.issues.get(issueKey(params));
        if (!issue) return NOT_FOUND;
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
        if (!fake.issues.has(key)) return NOT_FOUND;
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
    fake.route('POST', '/repos/:owner/:repo/issues/:number/labels', ({ params, body }) => {
        const issue = fake.issues.get(issueKey(params));
        if (!issue) return NOT_FOUND;
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
        if (file) return { status: 200, body: file };
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
