/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createGithubApp } from '@chamvi/github';
import type { GithubAppOptions } from '@chamvi/github';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';

const clock = new ControllableClock(new Date('2026-10-20T10:00:00Z'));
const fake = createFakeGithub({ appId: '123', clock });

function options(overrides: Partial<GithubAppOptions> = {}): GithubAppOptions {
    return {
        appId: 123,
        privateKey: fake.privateKey,
        webhookSecret: 'webhook-secret',
        clock,
        fetch: fake.fetch,
        ...overrides,
    };
}

describe('createGithubApp', () => {
    it('builds an app', () => {
        const gh = createGithubApp(options({ installationId: 42 }));

        expect(gh.appId).toBe('123');
        expect(gh.installationId).toBe(42);
    });

    it.each([
        ['an empty appId', { appId: '' }],
        ['an unparsable privateKey', { privateKey: 'not a key' }],
        ['an empty privateKey', { privateKey: '' }],
        ['an empty webhookSecret', { webhookSecret: '' }],
        ['an empty webhookSecret list', { webhookSecret: [] }],
        ['an empty secret in the list', { webhookSecret: ['a', ''] }],
        ['a zero installationId', { installationId: 0 }],
        ['a negative installationId', { installationId: -1 }],
        ['a fractional installationId', { installationId: 1.5 }],
        ['a slug with upper case', { slug: 'Chamvi-Test' }],
        ['a slug with a space', { slug: 'Chamvi Test' }],
        ['a slug with a trailing space', { slug: 'chamvi-test ' }],
        ['an empty slug', { slug: '' }],
        ['a slug with the [bot] suffix', { slug: 'chamvi-test[bot]' }],
        ['a scheme-less baseUrl', { baseUrl: 'ghe.example.com/api/v3' }],
        ['a non-http baseUrl', { baseUrl: 'ftp://ghe.example.com/api/v3' }],
        ['a plain http baseUrl', { baseUrl: 'http://ghe.example.com/api/v3' }],
        ['a baseUrl with a query', { baseUrl: 'https://ghe.example.com/api/v3?x=1' }],
        ['a baseUrl with a hash', { baseUrl: 'https://ghe.example.com/api/v3#x' }],
        ['a non-RSA privateKey', { privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }],
    ])('refuses %s', (_name, overrides) => {
        expect(() => createGithubApp(options(overrides))).toThrow(InvalidAgentDefinitionError);
    });

    it('accepts a PEM with literal \\n sequences', async () => {
        const escaped = fake.privateKey.trim().replaceAll('\n', '\\n');

        expect(escaped).not.toContain('\n');

        const gh = createGithubApp(options({ privateKey: escaped }));
        const octokit = await gh.octokit(42);

        await octokit.request('GET /rate_limit');
        expect(fake.tokensIssued).toBeGreaterThan(0);
    });

    it('accepts a PKCS#8 key', async () => {
        const pkcs8 = createPrivateKey(fake.privateKey).export({ type: 'pkcs8', format: 'pem' }).toString();

        expect(pkcs8).toContain('BEGIN PRIVATE KEY');

        const issued = fake.tokensIssued;
        const gh = createGithubApp(options({ privateKey: pkcs8 }));

        await (await gh.octokit(43)).request('GET /rate_limit');
        expect(fake.tokensIssued).toBe(issued + 1);
    });

    it('takes the bot login from a valid slug without GET /app', async () => {
        const gh = createGithubApp(options({ slug: 'chamvi-test' }));

        expect(await gh.botLogin()).toBe('chamvi-test[bot]');
    });

    it('refuses a GET /app answer without a slug and does not cache it', async () => {
        let slug: string | undefined;
        const fetch: typeof globalThis.fetch = async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input));

            if (url.pathname === '/app') {
                return new Response(JSON.stringify({ id: 123, ...(slug ? { slug } : {}) }), { headers: { 'content-type': 'application/json' } });
            }

            return fake.fetch(input, init);
        };
        const gh = createGithubApp(options({ fetch }));

        await expect(gh.botLogin()).rejects.toThrow(/slug/);
        slug = 'chamvi-test';
        expect(await gh.botLogin()).toBe('chamvi-test[bot]');
    });

    it.each([
        ['https://ghe.example.com/api/v3/', 'https://ghe.example.com/api/v3/app/installations/42/access_tokens'],
        ['', 'https://api.github.com/app/installations/42/access_tokens'],
    ])('sends requests to the baseUrl %j', async (baseUrl, expected) => {
        const urls: string[] = [];
        const fetch: typeof globalThis.fetch = async (input) => {
            urls.push(input instanceof Request ? input.url : String(input));

            return new Response(JSON.stringify({ token: 'ghs_test', expires_at: '2026-10-20T11:00:00Z' }), {
                status: 201,
                headers: { 'content-type': 'application/json' },
            });
        };
        const gh = createGithubApp(options({ baseUrl, fetch }));

        await gh.octokit(42);
        expect(urls[0]).toBe(expected);
    });
});
