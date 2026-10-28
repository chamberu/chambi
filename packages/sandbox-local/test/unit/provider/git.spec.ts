/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { SandboxError } from '@chamvi/core';
import { createWorkspaceManager, staticGitCredentials } from '@chamvi/sandbox';
import type { IWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import { canServeGit, startGitServer } from '../../utils/git-server.ts';
import type { GitServer } from '../../utils/git-server.ts';

const TOKEN = 'glpat-s3cretPrivateToken';

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

    function manager(root = join(tmp, String(Math.random()).slice(2)), token = TOKEN): IWorkspaceManager {
        return createWorkspaceManager({
            provider: createLocalSandbox({ root, env: { GIT_SSL_CAINFO: server.caFile } }),
            gcIntervalMs: 0,
            credentials: staticGitCredentials([{
                host: server.host,
                token,
                username: 'oauth2',
            }]),
            author: { name: 'chamvi test', email: 'test@chamvi.dev' },
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

    it('checks out a private branch through the workspace helper, then plain git fetches, pulls and pushes', async () => {
        const workspaces = manager();
        try {
            const { workspace } = await workspaces.acquire('r1', { repo: repoUrl(), ref: 'feature' });
            expect(workspace.info.defaultBranch).toBe('main');
            const sh = async (command: string) => workspace.exec(['sh', '-c', command]);

            expect((await sh('git rev-parse --abbrev-ref HEAD')).stdout.trim()).toBe('feature');
            expect((await sh('git log -1 --format=%s')).stdout.trim()).toBe('feature work');
            expect((await sh('git fetch -q origin && git pull -q --no-rebase origin feature')).exitCode).toBe(0);
            expect((await sh('echo fix > fix.txt && git add fix.txt && git commit -q -m fix && git push -q origin feature 2>&1')).exitCode).toBe(0);
            expect((await server.git('demo', 'log', '-1', '--format=%s %an <%ae>', 'refs/heads/feature')).trim()).toBe('fix chamvi test <test@chamvi.dev>');
        } finally {
            await workspaces.close();
        }
    }, 60_000);

    it('fails a checkout with a refused token without echoing it', async () => {
        const wrong = 'glpat-wrongTokenValue';
        const workspaces = manager(undefined, wrong);
        try {
            const error = await workspaces.acquire('r1', { repo: repoUrl() }).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(SandboxError);
            expect((error as Error).message).toMatch(/checkout failed: git ls-remote/);
            expect((error as Error).message).not.toContain(wrong);
        } finally {
            await workspaces.close();
        }
    }, 60_000);

    it('installs the credentials again into a workspace a restarted process finds', async () => {
        const root = join(tmp, 'restart');
        const first = manager(root);
        const { workspace } = await first.acquire('r1', { repo: repoUrl() });
        await first.close();
        const restarted = manager(root);
        try {
            const found = await restarted.get('r1');
            expect(found.id).toBe(workspace.id);
            const file = await found.exec(['sh', '-c', 'cat "$HOME/.chamvi/credentials"']);
            expect(file.stdout).toContain('[redacted]');
            expect((await found.exec(['git', 'fetch', '-q', 'origin'])).exitCode).toBe(0);
        } finally {
            await restarted.close({ dispose: true });
        }
    }, 60_000);

    it('keeps the token in the 0600 file only, and answers it redacted', async () => {
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
