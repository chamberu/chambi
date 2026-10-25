/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, SandboxError } from '@chamvi/core';
import { staticGitCredentials } from '@chamvi/sandbox';
import type { GitCredentialRequest } from '@chamvi/sandbox';
import { credentialRequest, resolveGitCredential } from '../../../src/credentials/helpers.ts';

const TOKEN = 'ghp_0123456789abcdef';

function request(url: string, access: 'read' | 'write' = 'read'): GitCredentialRequest {
    return credentialRequest(url, access, 'run-1');
}

describe('credentialRequest', () => {
    it('splits a repository URL into host and path', () => {
        expect(request('https://GitHub.com/octo/demo.git')).toEqual({
            url: 'https://github.com/octo/demo.git',
            host: 'github.com',
            path: 'octo/demo',
            access: 'read',
            runId: 'run-1',
        });
        expect(request('https://git.example.com:8443/group/sub/repo/').host).toBe('git.example.com:8443');
        expect(request('https://git.example.com:8443/group/sub/repo/').path).toBe('group/sub/repo');
    });

    it('asks for the host itself with an empty path', () => {
        expect(request('https://github.com/').path).toBe('');
    });
});

describe('staticGitCredentials', () => {
    it('answers a token for its host, with a GitHub username by default', async () => {
        const credentials = staticGitCredentials([{ host: 'github.com', token: TOKEN }]);
        await expect(credentials.get(request('https://github.com/octo/demo.git'))).resolves.toEqual({
            username: 'x-access-token',
            password: TOKEN,
        });
        await expect(credentials.get(request('https://gitlab.com/octo/demo.git'))).resolves.toBeUndefined();
    });

    it('uses oauth2 for a GitLab host and keeps a given username', async () => {
        const credentials = staticGitCredentials([
            { host: 'gitlab.example.com', token: 'glpat-aaaa' },
            { host: 'git.example.com', username: 'deploy', token: 'tok-bbbb' },
        ]);
        await expect(credentials.get(request('https://gitlab.example.com/g/r.git'))).resolves.toMatchObject({ username: 'oauth2' });
        await expect(credentials.get(request('https://git.example.com/g/r.git'))).resolves.toMatchObject({ username: 'deploy' });
    });

    it('matches the host case-insensitively and the path by whole segments, the longest prefix first', async () => {
        const credentials = staticGitCredentials([
            { host: 'GitHub.com', path: 'octo', token: 'owner-token' },
            { host: 'github.com', path: 'octo/demo', token: 'repo-token' },
            { host: 'github.com', token: 'host-token' },
        ]);
        await expect(credentials.get(request('https://github.com/octo/demo.git'))).resolves.toMatchObject({ password: 'repo-token' });
        await expect(credentials.get(request('https://github.com/octo/other.git'))).resolves.toMatchObject({ password: 'owner-token' });
        await expect(credentials.get(request('https://github.com/octopus/demo.git'))).resolves.toMatchObject({ password: 'host-token' });
        await expect(credentials.get(request('https://github.com/'))).resolves.toMatchObject({ password: 'host-token' });
    });

    it('answers nothing for a path below no entry and for the bare host of a path entry', async () => {
        const credentials = staticGitCredentials([{ host: 'github.com', path: '/octo/', token: TOKEN }]);
        await expect(credentials.get(request('https://github.com/other/demo.git'))).resolves.toBeUndefined();
        await expect(credentials.get(request('https://github.com/'))).resolves.toBeUndefined();
        await expect(credentials.get(request('https://github.com/octo/demo'))).resolves.toMatchObject({ password: TOKEN });
    });

    it('refuses malformed entries without echoing the token', () => {
        const cases: unknown[] = [
            'nope',
            [{ host: 'github.com' }],
            [{ host: '', token: TOKEN }],
            [{ host: 'github.com/x', token: TOKEN }],
            [{ host: 'github.com', token: `${TOKEN}\n` }],
            [{ host: 'github.com', token: TOKEN, username: 'a\tb' }],
            [{ host: 'github.com', token: TOKEN, path: 'a/../b' }],
        ];
        for (const entries of cases) {
            let error: unknown;
            try {
                staticGitCredentials(entries as never);
            } catch (e) {
                error = e;
            }
            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect((error as Error).message).not.toContain(TOKEN);
        }
    });
});

describe('resolveGitCredential', () => {
    it('takes the first answer', async () => {
        const calls: string[] = [];
        const source = (name: string, answer?: { username: string; password: string }) => ({
            get: async () => {
                calls.push(name);
                return answer;
            },
        });
        const credential = await resolveGitCredential([
            source('a'),
            source('b', { username: 'u', password: 'p-1234' }),
            source('c', { username: 'u', password: 'p-5678' }),
        ], request('https://github.com/o/r.git'));
        expect(credential).toEqual({ username: 'u', password: 'p-1234' });
        expect(calls).toEqual(['a', 'b']);
    });

    it('refuses an answer git cannot take, without echoing it', async () => {
        const promise = resolveGitCredential([{ get: async () => ({ username: 'u', password: 'secret\nvalue' }) }], request('https://github.com/o/r.git'));
        await expect(promise).rejects.toThrow(SandboxError);
        await expect(promise).rejects.not.toThrow(/secret/);
    });

    it('wraps a failing source in a SandboxError naming the repository', async () => {
        const promise = resolveGitCredential([{ get: async () => { throw new Error('GitHub 502'); } }], request('https://github.com/o/r.git'));
        await expect(promise).rejects.toThrow(SandboxError);
        await expect(promise).rejects.toThrow(/github\.com\/o\/r.*GitHub 502/);
    });
});
