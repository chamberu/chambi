/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createGithubApp } from '@chamvi/github';
import type { GithubAppOptions } from '@chamvi/github';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';
import { APP_REQUEST_TIMEOUT_MS } from '../../../src/auth/constants.ts';

const START = new Date('2026-10-20T10:00:00Z');

function setup(overrides: Partial<GithubAppOptions> = {}) {
    const clock = new ControllableClock(START);
    const fake = createFakeGithub({ appId: '123', clock });
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

/** The authorization header of the latest non-App request. */
function lastToken(fake: ReturnType<typeof createFakeGithub>): string | null | undefined {
    return fake.requests.findLast((r) => r.path === '/rate_limit')?.authorization;
}

describe('installation tokens', () => {
    it('exchanges a JWT for an installation token and reuses it', async () => {
        const { fake, gh } = setup();

        await (await gh.octokit(42)).request('GET /rate_limit');
        await (await gh.octokit(42)).request('GET /rate_limit');
        expect(fake.tokensIssued).toBe(1);

        const calls = fake.requests.filter((r) => r.path === '/rate_limit');

        expect(calls.map((r) => r.authorization)).toEqual(['token ghs_1', 'token ghs_1']);
        expect(fake.requests[0]).toMatchObject({ method: 'POST', path: '/app/installations/42/access_tokens' });
    });

    it('refreshes 5 minutes before expiry', async () => {
        const {
            clock,
            fake,
            gh,
        } = setup();

        await (await gh.octokit(42)).request('GET /rate_limit');
        clock.advance(54 * 60_000);
        await (await gh.octokit(42)).request('GET /rate_limit');
        expect(lastToken(fake)).toBe('token ghs_1');
        clock.advance(60_000);
        await (await gh.octokit(42)).request('GET /rate_limit');
        expect(lastToken(fake)).toBe('token ghs_2');
        expect(fake.tokensIssued).toBe(2);
    });

    it('does not reuse an expired token hours later', async () => {
        const {
            clock,
            fake,
            gh,
        } = setup();

        await (await gh.octokit(42)).request('GET /rate_limit');
        clock.advance(5 * 3_600_000);
        await (await gh.octokit(42)).request('GET /rate_limit');
        expect(lastToken(fake)).toBe('token ghs_2');
    });

    it('shares one exchange between concurrent callers', async () => {
        const { fake, gh } = setup();

        await Promise.all(Array.from({ length: 5 }, () => gh.octokit(42)));
        expect(fake.tokensIssued).toBe(1);
    });

    it('does not cache a failed exchange', async () => {
        const { fake, gh } = setup();

        fake.failNext('POST', '/app/installations/42/access_tokens', 500);
        await expect(gh.octokit(42)).rejects.toThrow();
        await (await gh.octokit(42)).request('GET /rate_limit');
        expect(fake.tokensIssued).toBe(1);
        expect(lastToken(fake)).toBe('token ghs_1');
    });

    it('keeps the token out of a failed exchange error', async () => {
        const { fake, gh } = setup();

        fake.failNext('POST', '/app/installations/42/access_tokens', 500);

        const error = await gh.octokit(42).catch((e: unknown) => e);

        // a JWT starts with the base64url of '{"'
        for (const text of [String(error), JSON.stringify(error)]) {
            expect(text).not.toContain('eyJ');
            expect(text).not.toContain('PRIVATE KEY');
        }
    });

    it('keeps tokens per installation', async () => {
        const { fake, gh } = setup();

        await gh.octokit(1);
        await gh.octokit(2);
        await gh.octokit(1);
        expect(fake.tokensIssued).toBe(2);
        expect(fake.tokenInstallations).toEqual([1, 2]);
    });

    it('signs the JWT with iat backdated 60 s and exp 540 s ahead', async () => {
        const { fake, gh } = setup();

        await gh.octokit(42);

        const now = START.getTime() / 1000;

        expect(fake.jwtClaims).toEqual([{
            iat: now - 60,
            exp: now + 540,
            iss: '123',
        }]);
    });
});

describe('botLogin', () => {
    it('reads the slug once', async () => {
        const { fake, gh } = setup();

        expect(await gh.botLogin()).toBe('chamvi-test[bot]');
        expect(await gh.botLogin()).toBe('chamvi-test[bot]');
        expect(fake.requests.filter((r) => r.path === '/app')).toHaveLength(1);
    });

    it('shares one lookup between concurrent callers', async () => {
        const { fake, gh } = setup();

        await Promise.all([gh.botLogin(), gh.botLogin(), gh.botLogin()]);
        expect(fake.requests.filter((r) => r.path === '/app')).toHaveLength(1);
    });

    it('does not cache a failed lookup', async () => {
        const { fake, gh } = setup();

        fake.failNext('GET', '/app', 500);
        await expect(gh.botLogin()).rejects.toThrow();
        expect(await gh.botLogin()).toBe('chamvi-test[bot]');
    });

    it('uses the configured slug without a request', async () => {
        const { fake, gh } = setup({ slug: 'x' });

        expect(await gh.botLogin()).toBe('x[bot]');
        expect(fake.requests).toHaveLength(0);
    });
});

/** A fetch whose first `stalls` App requests never answer (until aborted); the rest go to `fake`. */
function stallingFetch(fake: ReturnType<typeof createFakeGithub>, stalls = 1) {
    const state = { stalled: 0 };
    const fetch: typeof globalThis.fetch = (input, init) => {
        if (state.stalled < stalls) {
            state.stalled++;

            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            });
        }

        return fake.fetch(input, init);
    };

    return { fetch, state };
}

const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

describe('app-authenticated requests', () => {
    it('time out a stalled token exchange for every waiter, and the next caller retries', async () => {
        const clock = new ControllableClock(START);
        const fake = createFakeGithub({ appId: '123', clock });
        const { fetch, state } = stallingFetch(fake);
        const { gh } = setup({
            clock,
            fetch,
            privateKey: fake.privateKey,
        });
        const first = gh.octokit(42);
        const second = gh.octokit(42);

        await flush();
        expect(state.stalled).toBe(1);
        clock.advance(APP_REQUEST_TIMEOUT_MS);
        await expect(first).rejects.toThrow(/did not answer/);
        await expect(second).rejects.toThrow(/did not answer/);
        await (await gh.octokit(42)).request('GET /rate_limit');
        expect(fake.tokensIssued).toBe(1);
    });

    it('time out a stalled GET /app, and the next botLogin retries', async () => {
        const clock = new ControllableClock(START);
        const fake = createFakeGithub({ appId: '123', clock });
        const { fetch } = stallingFetch(fake);
        const { gh } = setup({
            clock,
            fetch,
            privateKey: fake.privateKey,
        });
        const login = gh.botLogin();

        await flush();
        clock.advance(APP_REQUEST_TIMEOUT_MS);
        await expect(login).rejects.toThrow(/did not answer/);
        expect(await gh.botLogin()).toBe('chamvi-test[bot]');
    });
});
