/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolSet } from 'ai';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { MemoryStore, SandboxError, createAgentState } from '@chamvi/core';
import type { IRunArtifacts, ToolContext } from '@chamvi/core';
import { createWorkspaceManager, staticGitCredentials } from '@chamvi/sandbox';
import type { CredentialMode, GitPushResult, IWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import { canServeGit, startGitServer } from '../../utils/git-server.ts';
import type { GitServer } from '../../utils/git-server.ts';

const TOKEN = 'glpat-s3cretPrivateToken';

function toolContext(runId: string): ToolContext {
    return {
        channels: {} as ToolContext['channels'],
        run: {
            runId,
            agent: 'coder',
            trigger: {
                id: `env-${runId}`,
                agent: 'coder',
                trigger: 'http',
                channel: 'http',
                payload: {},
                receivedAt: new Date(0),
            },
            signal: new AbortController().signal,
        },
        state: createAgentState('coder', undefined, new MemoryStore()),
        artifacts: {} as IRunArtifacts,
    };
}

async function call<T>(tools: ToolSet, name: string, input: unknown): Promise<T> {
    const execute = tools[name]!.execute as (i: unknown, o: unknown) => Promise<unknown>;
    return await execute(input, {
        toolCallId: 'call-1', 
        messages: [], 
        context: toolContext('r1'), 
    }) as T;
}

const serving = await canServeGit();

describe.skipIf(!serving && !process.env.CI)('git against a private https host', () => {
    let fixture: GitFixture;
    let server: GitServer;
    let tmp: string;

    beforeAll(async () => {
        fixture = await createGitFixture({ 'README.md': '# private\n' });
        await fixture.git('switch', '-q', '-c', 'feature');
        await fixture.git('commit', '-q', '--allow-empty', '-m', 'feature work');
        await fixture.git('switch', '-q', 'main');
        server = await startGitServer({
            repos: { demo: fixture.path }, 
            username: 'oauth2', 
            password: TOKEN, 
        });
        tmp = await mkdtemp(join(tmpdir(), 'chamvi-local-git-'));
    }, 60_000);

    afterAll(async () => {
        await server?.close();
        await fixture?.cleanup();
        await rm(tmp, { recursive: true, force: true });
    });

    const repoUrl = () => `${server.origin}/demo.git`;

    function manager(mode?: CredentialMode, root = join(tmp, String(Math.random()).slice(2))): IWorkspaceManager {
        return createWorkspaceManager({
            provider: createLocalSandbox({ root, env: { GIT_SSL_CAINFO: server.caFile } }),
            gcIntervalMs: 0,
            credentials: staticGitCredentials([{
                host: server.host, 
                token: TOKEN, 
                username: 'oauth2', 
            }]),
            author: { name: 'chamvi test', email: 'test@chamvi.dev' },
            ...(mode && { credentialMode: mode }),
        });
    }

    it('refuses an anonymous checkout', async () => {
        const anonymous = createWorkspaceManager({
            provider: createLocalSandbox({ root: join(tmp, 'anonymous'), env: { GIT_SSL_CAINFO: server.caFile } }),
            gcIntervalMs: 0,
        });
        try {
            await expect(anonymous.acquire('r1', { repo: repoUrl() })).rejects.toThrow(SandboxError);
        } finally {
            await anonymous.close();
        }
    }, 60_000);

    it('tools mode: checks out and pushes with the token kept out of the workspace', async () => {
        const workspaces = manager('tools');
        try {
            const { workspace } = await workspaces.acquire('r1', { repo: repoUrl(), ref: 'feature' });
            expect(workspace.info.defaultBranch).toBe('main');
            const sh = async (command: string) => workspace.exec(['sh', '-c', command]);

            for (const probe of ['cat .git/config', 'env', 'cat "$HOME/.gitconfig" "$HOME/.chamvi/credentials" 2>&1; true']) {
                const result = await sh(probe);
                expect(result.stdout + result.stderr).not.toContain(TOKEN);
            }
            // a plain fetch in bash has no credentials
            expect((await sh('git fetch origin 2>&1')).exitCode).not.toBe(0);

            expect((await sh('echo fix > fix.txt && git add fix.txt && git commit -q -m fix')).exitCode).toBe(0);
            const pushed = await call<GitPushResult>(workspaces.tools(), 'git_push', {});
            expect(pushed).toMatchObject({
                pushed: true, 
                branch: 'feature', 
                exitCode: 0, 
            });
            expect(JSON.stringify(pushed)).not.toContain(TOKEN);
            expect((await server.git('demo', 'rev-parse', 'refs/heads/feature')).trim()).toBe(pushed.commit);
            expect((await server.git('demo', 'log', '-1', '--format=%an <%ae>', 'refs/heads/feature')).trim()).toBe('chamvi test <test@chamvi.dev>');

            // the default branch is refused
            await expect(call(workspaces.tools(), 'git_push', { branch: 'main' })).rejects.toThrow(/not allowed/);
            const fetched = await call<{ exitCode: number }>(workspaces.tools(), 'git_fetch', {});
            expect(fetched.exitCode).toBe(0);
        } finally {
            await workspaces.close();
        }
    }, 60_000);

    it('workspace mode: plain git works through the helper and the token comes back redacted', async () => {
        const workspaces = manager();
        try {
            const { workspace } = await workspaces.acquire('r1', { repo: repoUrl() });
            const sh = async (command: string) => workspace.exec(['sh', '-c', command]);

            const file = await sh('cat "$HOME/.chamvi/credentials"; ls -l "$HOME/.chamvi/credentials"');
            expect(file.stdout).toContain('[redacted]');
            expect(file.stdout).not.toContain(TOKEN);
            expect(file.stdout).toMatch(/^-rw-------/m);
            expect((await sh('cat .git/config; env')).stdout).not.toContain(TOKEN);

            expect((await sh('git fetch -q origin feature')).exitCode).toBe(0);
            const fill = await sh(`printf 'protocol=https\\nhost=${server.host}\\npath=demo.git\\n\\n' | git credential fill`);
            expect(fill.stdout).toContain('password=[redacted]');

            expect((await sh('git switch -q -c from-bash && git commit -q --allow-empty -m bash && git push -q origin HEAD:refs/heads/from-bash 2>&1')).exitCode).toBe(0);
            expect((await server.git('demo', 'log', '-1', '--format=%s', 'refs/heads/from-bash')).trim()).toBe('bash');
        } finally {
            await workspaces.close();
        }
    }, 60_000);
});
