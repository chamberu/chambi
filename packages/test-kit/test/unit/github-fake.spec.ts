/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';

function appJwt(privateKey: string, appId: string, now: Date): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(now.getTime() / 1000) - 60;
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
        iat, 
        exp: iat + 540, 
        iss: appId, 
    })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

describe('createFakeGithub', () => {
    it('exchanges an installation token for an App JWT', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const response = await fake.fetch('https://api.github.com/app/installations/42/access_tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` },
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ token: 'ghs_1' });
        expect(fake.tokenInstallations).toEqual([42]);
    });

    it('lists releases newest first, a page at a time', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const exchange = await fake.fetch('https://api.github.com/app/installations/42/access_tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` },
        });
        const { token } = await exchange.json() as { token: string };
        fake.releases.set('octo/demo', [{ tag_name: 'v1' }, { tag_name: 'v2' }, { tag_name: 'v3' }]);

        const response = await fake.fetch('https://api.github.com/repos/octo/demo/releases?per_page=2', { headers: { authorization: `token ${token}` } });
        expect(await response.json()).toEqual([{ tag_name: 'v3' }, { tag_name: 'v2' }]);
        expect(response.headers.get('link')).toContain('page=2');
    });

    it('refuses a JWT of another app', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const response = await fake.fetch('https://api.github.com/app', { headers: { authorization: `Bearer ${appJwt(fake.privateKey, '999', clock.now())}` } });
        expect(response.status).toBe(401);
    });

    it('rejects a pending request when its signal aborts', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const exchange = await fake.fetch('https://api.github.com/app/installations/42/access_tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` },
        });
        const { token } = await exchange.json() as { token: string };
        fake.route('GET', '/hang', () => new Promise(() => {}));
        const controller = new AbortController();
        const pending = fake.fetch('https://api.github.com/hang', {
            headers: { authorization: `token ${token}` },
            signal: controller.signal,
        });
        const reason = new Error('stop');
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
    });

    it('rejects a request whose signal is already aborted', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const reason = new Error('gone');
        await expect(fake.fetch('https://api.github.com/rate_limit', { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    });

    it('finds the installation of a repository with an App JWT and answers users without credentials', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        fake.installations.set('octo/demo', 42);
        fake.users.set('chamvi-test[bot]', 7);
        const jwt = { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` };
        const found = await fake.fetch('https://api.github.com/repos/Octo/Demo/installation', { headers: jwt });
        expect(await found.json()).toEqual({ id: 42 });
        expect((await fake.fetch('https://api.github.com/repos/octo/other/installation', { headers: jwt })).status).toBe(404);
        expect((await fake.fetch('https://api.github.com/repos/octo/demo/installation')).status).toBe(401);
        const user = await fake.fetch('https://api.github.com/users/chamvi-test%5Bbot%5D');
        expect(await user.json()).toEqual({
            login: 'chamvi-test[bot]', 
            id: 7, 
            type: 'Bot', 
        });
    });
});

describe('createFakeGithub repository routes', () => {
    const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));

    async function setup() {
        const fake = createFakeGithub({ appId: '123', clock });
        const jwt = { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` };
        const tokenOf = async (installationId: number) => {
            const exchange = await fake.fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
                method: 'POST',
                headers: jwt,
            });
            const { token } = await exchange.json() as { token: string };
            return token;
        };
        const call = async (method: string, path: string, body?: unknown, installationId = 42) => {
            const token = await tokenOf(installationId);
            const response = await fake.fetch(`https://api.github.com${path}`, {
                method,
                headers: { authorization: `token ${token}`, 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const text = await response.text();
            return {
                status: response.status, 
                body: text ? JSON.parse(text) as any : undefined, 
                headers: response.headers, 
            };
        };
        return {
            fake, 
            jwt, 
            call, 
        };
    }

    function pull(number: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            number,
            title: `PR ${number}`,
            state: 'open',
            merged: false,
            mergeable: true,
            mergeable_state: 'clean',
            head: {
                ref: `feature-${number}`, 
                label: `octo:feature-${number}`, 
                sha: `sha-${number}`, 
            },
            base: { ref: 'main' },
            ...patch,
        };
    }

    it('answers GET /app/installations only with the App JWT', async () => {
        const {
            fake, 
            jwt, 
            call, 
        } = await setup();
        fake.appInstallations.set(42, { id: 42, account: { login: 'tada5hi', type: 'User' } });
        const response = await fake.fetch('https://api.github.com/app/installations', { headers: jwt });
        expect(await response.json()).toEqual([{ id: 42, account: { login: 'tada5hi', type: 'User' } }]);
        expect((await call('GET', '/app/installations')).status).toBe(401);
    });

    it('lists the repositories of the token installation', async () => {
        const { fake, call } = await setup();
        fake.installations.set('octo/demo', 42);
        fake.installations.set('acme/api', 43);
        fake.repositories.set('octo/demo', { full_name: 'octo/demo', archived: true });
        const { body } = await call('GET', '/installation/repositories');
        expect(body).toEqual({ total_count: 1, repositories: [{ full_name: 'octo/demo', archived: true }] });
        const other = await call('GET', '/installation/repositories', undefined, 43);
        expect(other.body.repositories[0]).toMatchObject({
            full_name: 'acme/api', 
            name: 'api', 
            owner: { login: 'acme' }, 
            archived: false, 
            default_branch: 'main', 
        });
    });

    it('pages object lists with a link header', async () => {
        const { fake, call } = await setup();
        fake.installations.set('octo/a', 42);
        fake.installations.set('octo/b', 42);
        fake.installations.set('octo/c', 42);
        const first = await call('GET', '/installation/repositories?per_page=2');
        expect(first.body.total_count).toBe(3);
        expect(first.body.repositories).toHaveLength(2);
        expect(first.headers.get('link')).toContain('page=2');
    });

    it('answers a repository, stored or synthesized', async () => {
        const { fake, call } = await setup();
        fake.repositories.set('octo/demo', { full_name: 'octo/demo', default_branch: 'develop' });
        expect((await call('GET', '/repos/octo/demo')).body).toEqual({ full_name: 'octo/demo', default_branch: 'develop' });
        expect((await call('GET', '/repos/acme/api')).body).toMatchObject({
            full_name: 'acme/api', 
            private: false, 
            fork: false, 
        });
    });

    it('lists the issues of a repository by state, creator and since', async () => {
        const { fake, call } = await setup();
        fake.issues.set('octo/demo#1', {
            number: 1, 
            state: 'open', 
            user: { login: 'a' }, 
            updated_at: '2026-10-20T00:00:00Z', 
        });
        fake.issues.set('octo/demo#2', {
            number: 2, 
            state: 'closed', 
            user: { login: 'b' }, 
            updated_at: '2026-10-21T00:00:00Z', 
        });
        fake.issues.set('acme/api#3', {
            number: 3, 
            state: 'open', 
            user: { login: 'a' }, 
            updated_at: '2026-10-21T00:00:00Z', 
        });
        const numbers = async (query: string) => ((await call('GET', `/repos/octo/demo/issues${query}`)).body as Array<{ number: number }>).map((i) => i.number);
        expect(await numbers('')).toEqual([1]);
        expect(await numbers('?state=all')).toEqual([1, 2]);
        expect(await numbers('?state=all&creator=b')).toEqual([2]);
        expect(await numbers('?state=all&since=2026-10-20T12:00:00Z')).toEqual([2]);
    });

    it('creates an issue as the bot with the next number', async () => {
        const { fake, call } = await setup();
        fake.issues.set('octo/demo#4', { number: 4 });
        fake.pulls.set('octo/demo#7', pull(7));
        const { status, body } = await call('POST', '/repos/octo/demo/issues', {
            title: 'Digest', 
            body: 'text', 
            labels: ['report'], 
        });
        expect(status).toBe(201);
        expect(body).toMatchObject({
            number: 8,
            title: 'Digest',
            body: 'text',
            state: 'open',
            labels: [{ name: 'report' }],
            user: { login: 'chamvi-test[bot]', type: 'Bot' },
            html_url: 'https://github.com/octo/demo/issues/8',
            created_at: '2026-10-21T09:00:00.000Z',
        });
        expect(fake.issues.get('octo/demo#8')).toBe(fake.issues.get('octo/demo#8'));
    });

    it('lists pull requests by state, head and base', async () => {
        const { fake, call } = await setup();
        fake.pulls.set('octo/demo#1', pull(1));
        fake.pulls.set('octo/demo#2', pull(2, { state: 'closed', base: { ref: 'develop' } }));
        const numbers = async (query: string) => ((await call('GET', `/repos/octo/demo/pulls${query}`)).body as Array<{ number: number }>).map((i) => i.number);
        expect(await numbers('')).toEqual([1]);
        expect(await numbers('?state=all')).toEqual([1, 2]);
        expect(await numbers('?state=all&base=develop')).toEqual([2]);
        expect(await numbers('?state=all&head=octo:feature-1')).toEqual([1]);
    });

    it('creates a pull request and refuses a second open pull for the same head and base with 422', async () => {
        const { fake, call } = await setup();
        fake.issues.set('octo/demo#3', { number: 3 });
        const created = await call('POST', '/repos/octo/demo/pulls', {
            title: 'Fix', 
            body: 'b', 
            head: 'fix-ci', 
            base: 'main', 
        });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({
            number: 4,
            state: 'open',
            draft: false,
            head: {
                ref: 'fix-ci', 
                label: 'octo:fix-ci', 
                sha: 'sha-fix-ci', 
                repo: { full_name: 'octo/demo' }, 
            },
            base: { ref: 'main', repo: { full_name: 'octo/demo' } },
            user: { login: 'chamvi-test[bot]', type: 'Bot' },
            html_url: 'https://github.com/octo/demo/pull/4',
        });
        const fork = await call('POST', '/repos/octo/demo/pulls', {
            title: 'Fork', 
            body: '', 
            head: 'someone:patch', 
            base: 'main', 
        });
        expect(fork.body.head).toMatchObject({
            ref: 'patch', 
            label: 'someone:patch', 
            repo: { full_name: 'someone/demo' }, 
        });
        const again = await call('POST', '/repos/octo/demo/pulls', {
            title: 'Fix', 
            body: 'b', 
            head: 'octo:fix-ci', 
            base: 'main', 
        });
        expect(again).toMatchObject({ status: 422, body: { message: 'A pull request already exists' } });
    });

    it('merges at the head sha only', async () => {
        const { fake, call } = await setup();
        fake.pulls.set('octo/demo#3', pull(3, {
            head: {
                ref: 'x', 
                label: 'octo:x', 
                sha: 'abc', 
            }, 
        }));
        expect((await call('PUT', '/repos/octo/demo/pulls/3/merge', { sha: 'zzz' })).status).toBe(409);
        const merged = await call('PUT', '/repos/octo/demo/pulls/3/merge', { sha: 'abc', merge_method: 'squash' });
        expect(merged.body).toEqual({
            sha: 'merge-3', 
            merged: true, 
            message: 'Pull Request successfully merged', 
        });
        expect(fake.pulls.get('octo/demo#3')).toMatchObject({
            merged: true, 
            state: 'closed', 
            merge_method: 'squash', 
            merge_commit_sha: 'merge-3', 
        });
        expect((await call('PUT', '/repos/octo/demo/pulls/3/merge', { sha: 'abc' })).status).toBe(405);
        expect((await call('PUT', '/repos/octo/demo/pulls/9/merge', { sha: 'abc' })).status).toBe(404);
        fake.pulls.set('octo/demo#5', pull(5, { mergeable: false }));
        expect((await call('PUT', '/repos/octo/demo/pulls/5/merge', { sha: 'sha-5' })).status).toBe(405);
    });

    it('lists the check runs of a commit', async () => {
        const { fake, call } = await setup();
        fake.checkRuns.set('octo/demo@abc', [{ name: 'lint' }, { name: 'test' }]);
        expect((await call('GET', '/repos/octo/demo/commits/abc/check-runs')).body).toEqual({ total_count: 2, check_runs: [{ name: 'lint' }, { name: 'test' }] });
        expect((await call('GET', '/repos/octo/demo/commits/other/check-runs')).body).toEqual({ total_count: 0, check_runs: [] });
    });

    it('derives the combined status state', async () => {
        const { fake, call } = await setup();
        const state = async (statuses?: Array<Record<string, unknown>>) => {
            if (statuses) fake.statuses.set('octo/demo@abc', statuses);
            const { body } = await call('GET', '/repos/octo/demo/commits/abc/status');
            return body.state as string;
        };
        expect(await state()).toBe('pending');
        expect(await state([{ context: 'ci', state: 'success' }])).toBe('success');
        expect(await state([{ context: 'ci', state: 'success' }, { context: 'e2e', state: 'pending' }])).toBe('pending');
        expect(await state([{ context: 'ci', state: 'success' }, { context: 'e2e', state: 'error' }])).toBe('failure');
        expect((await call('GET', '/repos/octo/demo/commits/abc/status')).body).toMatchObject({ sha: 'abc', total_count: 2 });
    });

    it('answers branch protection and rules, stored or empty', async () => {
        const { fake, call } = await setup();
        expect((await call('GET', '/repos/octo/demo/branches/main')).body).toEqual({
            name: 'main',
            protected: false,
            protection: {
                enabled: false,
                required_status_checks: {
                    enforcement_level: 'off', 
                    contexts: [], 
                    checks: [], 
                }, 
            },
        });
        fake.branches.set('octo/demo:main', { name: 'main', protected: true });
        expect((await call('GET', '/repos/octo/demo/branches/main')).body).toEqual({ name: 'main', protected: true });
        expect((await call('GET', '/repos/octo/demo/rules/branches/main')).body).toEqual([]);
        fake.rules.set('octo/demo:main', [{ type: 'required_status_checks' }]);
        expect((await call('GET', '/repos/octo/demo/rules/branches/main')).body).toEqual([{ type: 'required_status_checks' }]);
    });
});
