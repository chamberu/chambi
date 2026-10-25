/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as pkg from '@chamvi/github';

describe('public api', () => {
    it.each([
        'createGithubApp',
        'githubAppCredentials',
        'githubChannel',
        'injectGithubContext',
        'provideGithubContext',
    ])('exports %s', (name) => {
        expect(pkg).toHaveProperty(name);
        expect(pkg[name as keyof typeof pkg]).toBeTypeOf('function');
    });

    it('exports the github subscriber', () => {
        expect(pkg.github.on).toBeTypeOf('function');
        expect(pkg.github.to).toBeTypeOf('function');
    });

    it('exports the defaults', () => {
        expect(pkg.GITHUB_CHANNEL_NAME).toBe('github');
        expect(pkg.GITHUB_CHANNEL_TIMEOUT_MS).toBe(30_000);
        expect(pkg.COMMENT_BODY_MAX_LENGTH).toBe(60_000);
        expect(pkg.DEFAULT_GITHUB_API_URL).toBe('https://api.github.com');
        expect(pkg.DEFAULT_GITHUB_GIT_HOST).toBe('github.com');
        expect(pkg.GITHUB_TOKEN_USERNAME).toBe('x-access-token');
    });

    it('exports the request error code and the repository pattern', () => {
        expect(pkg.GITHUB_REQUEST_ERROR_CODE).toBe('github_request');
        const repo = new RegExp(pkg.REPO_PATTERN);
        expect(repo.test('octo/demo')).toBe(true);
        expect(repo.test('a/../b')).toBe(false);
        expect(repo.test('../x')).toBe(false);
    });

    it.each([
        'githubWebhook',
        'DEFAULT_WEBHOOK_PATH',
        'githubNotifier',
        'provideGithubNotifierContext',
        'injectGithubNotifierContext',
    ])('no longer exports %s', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });

    it.each([
        'verifySignature',
        'createAppJwt',
        'createInstallationTokens',
        'withAppTimeout',
        'createWebhookRoute',
        'receiveDelivery',
        'GITHUB_CONTEXT',
        'createReadTools',
        'createWriteTools',
        'matchesGithubSubscription',
        'createGithubSubscription',
        'normalizePrivateKey',
        'parseAddress',
        'renderComment',
        'resolveOptions',
        'markerKey',
        'stepOf',
    ])('keeps %s internal', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });

    it.each([
        'githubModule',
        'GithubModule',
        'GITHUB_MODULE_NAME',
    ])('the main entry keeps %s out', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });
});
