/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createGithubApp, githubAppCredentials } from '@chamvi/github';
import type { GithubAppOptions, GithubGitCredentialRequest } from '@chamvi/github';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';

const START = new Date('2026-10-20T10:00:00Z');

function setup(overrides: Partial<GithubAppOptions> = {}) {
    const clock = new ControllableClock(START);
    const fake = createFakeGithub({
        appId: '123', 
        slug: 'demo-bot', 
        clock, 
    });
    fake.installations.set('octo/demo', 42);
    const gh = createGithubApp({
        appId: 123,
        privateKey: fake.privateKey,
        webhookSecret: 'webhook-secret',
        clock,
        fetch: fake.fetch,
        ...overrides,
    });
    return {
        clock,
        fake,
        gh,
    };
}

function request(input: Partial<GithubGitCredentialRequest> = {}): GithubGitCredentialRequest {
    return {
        url: 'https://github.com/octo/demo.git',
        host: 'github.com',
        path: 'octo/demo',
        access: 'read',
        runId: 'r1',
        ...input,
    };
}

/** The bodies of the token exchanges, in order. */
function exchanges(fake: ReturnType<typeof createFakeGithub>) {
    return fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/access_tokens')).map((r) => ({ path: r.path, body: r.body }));
}

describe('IGithubApp.repositoryToken', () => {
    it('issues a token scoped to the one repository with the asked permissions', async () => {
        const { fake, gh } = setup();
        const token = await gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'read' } });
        expect(token).toEqual({ token: 'ghs_1', expiresAt: new Date(START.getTime() + 3_600_000) });
        expect(fake.requests[0]).toMatchObject({ method: 'GET', path: '/repos/octo/demo/installation' });
        expect(exchanges(fake)).toEqual([{
            path: '/app/installations/42/access_tokens',
            body: { repositories: ['demo'], permissions: { contents: 'read' } },
        }]);
    });

    it('caches per repository and permissions until 5 minutes before expiry, sharing concurrent exchanges', async () => {
        const {
            fake, 
            gh, 
            clock, 
        } = setup();
        const read = { permissions: { contents: 'read' as const } };
        const [a, b] = await Promise.all([
            gh.repositoryToken({ owner: 'octo', repo: 'demo' }, read),
            gh.repositoryToken({ owner: 'Octo', repo: 'Demo' }, read),
        ]);
        expect(a!.token).toBe(b!.token);
        await gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'write' } });
        expect(fake.tokensIssued).toBe(2);

        clock.advance(54 * 60_000);
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'demo' }, read)).resolves.toMatchObject({ token: 'ghs_1' });
        clock.advance(60_000);
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'demo' }, read)).resolves.toMatchObject({ token: 'ghs_3' });
    });

    it('answers undefined for a repository the App is not installed on', async () => {
        const { fake, gh } = setup();
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'other' }, { permissions: { contents: 'read' } })).resolves.toBeUndefined();
        expect(fake.tokensIssued).toBe(0);
    });

    it('looks up the installation of a repository once, so a cached token survives a failing lookup', async () => {
        const { fake, gh } = setup();
        const read = { permissions: { contents: 'read' as const } };
        await gh.repositoryToken({ owner: 'octo', repo: 'demo' }, read);
        fake.failNext('GET', '/repos/octo/demo/installation', 502);
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'demo' }, read)).resolves.toMatchObject({ token: 'ghs_1' });
        await expect(gh.repositoryToken({ owner: 'Octo', repo: 'Demo' }, read)).resolves.toMatchObject({ token: 'ghs_1' });
        expect(fake.requests.filter((r) => r.path.toLowerCase() === '/repos/octo/demo/installation')).toHaveLength(1);
    });

    it('looks the installation up again once its token exchange failed', async () => {
        const { fake, gh } = setup();
        await gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'read' } });
        fake.failNext('POST', '/app/installations/42/access_tokens', 404);
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'write' } })).rejects.toThrow(/404/);
        await gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'write' } });
        expect(fake.requests.filter((r) => r.path === '/repos/octo/demo/installation')).toHaveLength(2);
    });

    it('does not cache a failure', async () => {
        const { fake, gh } = setup();
        fake.failNext('GET', '/repos/octo/demo/installation', 502);
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'read' } })).rejects.toThrow(/502/);
        await expect(gh.repositoryToken({ owner: 'octo', repo: 'demo' }, { permissions: { contents: 'read' } })).resolves.toMatchObject({ token: 'ghs_1' });
    });
});

describe('IGithubApp.botIdentity', () => {
    it('is the bot login with its noreply address', async () => {
        const { fake, gh } = setup();
        fake.users.set('demo-bot[bot]', 9_001);
        await expect(gh.botIdentity()).resolves.toEqual({
            name: 'demo-bot[bot]',
            email: '9001+demo-bot[bot]@users.noreply.github.com',
        });
        await gh.botIdentity();
        expect(fake.requests.filter((r) => r.path.startsWith('/users/'))).toHaveLength(1);
    });
});

describe('githubAppCredentials', () => {
    it('answers a read token with contents read', async () => {
        const { fake, gh } = setup();
        const credentials = githubAppCredentials(gh);
        await expect(credentials.get(request())).resolves.toEqual({
            username: 'x-access-token',
            password: 'ghs_1',
            expiresAt: new Date(START.getTime() + 3_600_000),
        });
        expect(exchanges(fake)[0]!.body).toEqual({ repositories: ['demo'], permissions: { contents: 'read' } });
    });

    it('answers a write token with contents write and the extra permissions', async () => {
        const { fake, gh } = setup();
        const credentials = githubAppCredentials(gh, { permissions: { workflows: 'write' } });
        await credentials.get(request({ access: 'write' }));
        expect(exchanges(fake)[0]!.body).toEqual({ repositories: ['demo'], permissions: { contents: 'write', workflows: 'write' } });
    });

    it('answers nothing for another host, the host itself or a repository it is not installed on', async () => {
        const { fake, gh } = setup();
        const credentials = githubAppCredentials(gh);
        await expect(credentials.get(request({ host: 'gitlab.com' }))).resolves.toBeUndefined();
        await expect(credentials.get(request({ path: '' }))).resolves.toBeUndefined();
        await expect(credentials.get(request({ path: 'octo/demo/extra' }))).resolves.toBeUndefined();
        await expect(credentials.get(request({ path: 'octo/other' }))).resolves.toBeUndefined();
        expect(fake.tokensIssued).toBe(0);
    });

    it('serves a GitHub Enterprise host when given', async () => {
        const { gh } = setup();
        const credentials = githubAppCredentials(gh, { host: 'GHE.example.com' });
        await expect(credentials.get(request({ host: 'github.com' }))).resolves.toBeUndefined();
        await expect(credentials.get(request({ host: 'ghe.example.com' }))).resolves.toMatchObject({ password: 'ghs_1' });
    });

    it('refuses bad options', () => {
        const { gh } = setup();
        expect(() => githubAppCredentials({} as typeof gh)).toThrow(InvalidAgentDefinitionError);
        expect(() => githubAppCredentials(gh, { permissions: { contents: 'admin' as 'write' } })).toThrow(InvalidAgentDefinitionError);
        expect(() => githubAppCredentials(gh, { host: 'not a host' })).toThrow(InvalidAgentDefinitionError);
    });
});
