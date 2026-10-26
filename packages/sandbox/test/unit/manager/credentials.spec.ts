/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, SandboxError } from '@chamvi/core';
import { createWorkspaceManager, staticGitCredentials } from '@chamvi/sandbox';
import type {
    ExecOptions,
    ExecResult,
    GitCredential,
    GitCredentialRequest,
    IGitCredentials,
    WorkspaceManagerOptions,
} from '@chamvi/sandbox';
import { INSTALL_CREDENTIALS_SCRIPT, READ_CREDENTIALS_SCRIPT } from '../../../src/git/constants.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { createFakeProvider } from '../../utils/provider.ts';
import type { ScriptedWorkspace } from '../../utils/workspace.ts';

const START = 1_000_000;
const REPO = 'https://github.com/octo/demo.git';
const HOUR = 3_600_000;

/** A source answering `write-<n>`/`read-<n>` tokens valid for an hour, counting its calls. */
function tokenSource(clock: ControllableClock) {
    const requests: GitCredentialRequest[] = [];
    let issued = 0;
    let failing: Error | undefined;
    const source: IGitCredentials & { requests: GitCredentialRequest[]; fail(error?: Error): void } = {
        requests,
        fail(error) {
            failing = error;
        },
        async get(request) {
            requests.push(request);
            if (failing) throw failing;
            if (request.path === '') return undefined;
            issued++;
            return {
                username: 'x-access-token',
                password: `${request.access}-token-${issued}`,
                expiresAt: new Date(clock.now().getTime() + HOUR),
            } satisfies GitCredential;
        },
    };
    return source;
}

function isInstall(argv: readonly string[]): boolean {
    return argv[0] === 'sh' && argv[2] === INSTALL_CREDENTIALS_SCRIPT;
}

function installs(workspace: ScriptedWorkspace) {
    return workspace.calls.filter((call) => isInstall(call.argv));
}

function setup(
    options: Partial<WorkspaceManagerOptions> = {},
    onExec?: (argv: readonly string[], options: ExecOptions) => Partial<ExecResult>,
) {
    const clock = new ControllableClock(new Date(START));
    const provider = createFakeProvider({ clock, onExec });
    const source = tokenSource(clock);
    const errors: unknown[] = [];
    const build = () => createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
        credentials: source,
        onError: (error) => { errors.push(error); },
        ...options,
    });
    return {
        clock,
        provider,
        source,
        errors,
        build,
        manager: build(),
    };
}

describe('workspace manager credentials', () => {
    it('hands the checkout a read credential and the depth', async () => {
        const {
            manager, 
            provider, 
            source, 
        } = setup({ depth: 5, credentialMode: 'tools' });
        await manager.acquire('r1', { repo: 'octo/demo' });
        expect(provider.created[0]!.checkout).toEqual({
            depth: 5,
            credential: {
                username: 'x-access-token',
                password: 'read-token-1',
                expiresAt: new Date(START + HOUR),
            },
        });
        expect(source.requests[0]).toMatchObject({
            url: REPO,
            host: 'github.com',
            path: 'octo/demo',
            access: 'read',
            runId: 'r1',
        });
    });

    it('checks out anonymously when no source answers, and passes no checkout without credentials or depth', async () => {
        const { manager, provider } = setup({ credentials: [{ get: async () => undefined }], credentialMode: 'tools' });
        await manager.acquire('r1', { repo: 'octo/demo' });
        expect(provider.created[0]!.checkout).toBeUndefined();
    });

    it('fails the create with a SandboxError naming the repository when a source fails', async () => {
        const { manager, source } = setup();
        source.fail(new Error('GitHub is down'));
        const error = await manager.acquire('r1', { repo: 'octo/demo' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain('github.com/octo/demo');
    });

    describe('credentialMode workspace', () => {
        it('installs the read credential when the write lookup fails, reporting the failure once', async () => {
            const reads: string[] = [];
            const {
                manager, 
                provider, 
                errors, 
            } = setup({
                credentials: {
                    async get(request) {
                        if (request.path === '') return undefined;
                        if (request.access === 'write') throw new Error('GitHub 422: The permissions requested are not granted to this installation.');
                        reads.push(request.url);
                        return {
                            username: 'x-access-token', 
                            password: `read-token-${reads.length}`, 
                            expiresAt: new Date(START + HOUR), 
                        };
                    },
                },
            });
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            expect(installs(raw)).toHaveLength(1);
            expect(installs(raw)[0]!.options.stdin).toBe('https://github.com/octo/demo\tx-access-token\tread-token-2\n');
            expect(errors).toHaveLength(1);
            expect(String((errors[0] as Error).message)).toContain('422');

            await workspace.exec(['true']);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(1);
            expect(errors).toHaveLength(1);
        });

        it('installs the write credential of the repository after the create', async () => {
            const { manager, provider } = setup();
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            const [install] = installs(raw);
            expect(install).toBeDefined();
            expect(install!.options.stdin).toBe('https://github.com/octo/demo\tx-access-token\twrite-token-2\n');
            expect(install!.argv.at(-1)).toBe(String(Buffer.byteLength(install!.options.stdin!)));
        });

        it('refreshes before an exec once a credential expires within 10 minutes, not earlier', async () => {
            const {
                manager, 
                provider, 
                clock, 
            } = setup();
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(1);

            clock.advance(HOUR - 600_001);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(1);

            clock.advance(1);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(2);
            // the refresh runs before the exec it guards
            expect(isInstall(raw.calls.at(-2)!.argv)).toBe(true);
            expect(raw.calls.at(-1)!.argv).toEqual(['true']);
        });

        it('writes a fresh credentials file into a workspace found again before its first exec', async () => {
            const {
                manager, 
                provider, 
                build, 
            } = setup();
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            expect(installs(raw)).toHaveLength(1);

            const restarted = build();
            const found = await restarted.get('r1');
            await found.exec(['true']);
            expect(installs(raw)).toHaveLength(2);
            expect(raw.calls.at(-1)!.argv).toEqual(['true']);
        });

        it('reports a failing source, keeps exec working and retries a minute later', async () => {
            const {
                manager, 
                provider, 
                clock, 
                source, 
                errors,
            } = setup();
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            clock.advance(HOUR - 60_000);
            source.fail(new Error('GitHub is down'));

            await expect(workspace.exec(['true'])).resolves.toMatchObject({ exitCode: 0 });
            expect(errors).toHaveLength(1);
            expect(String(errors[0])).toContain('GitHub is down');
            const asked = source.requests.length;

            clock.advance(59_999);
            await workspace.exec(['true']);
            expect(source.requests).toHaveLength(asked);

            source.fail(undefined);
            clock.advance(1);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(2);
            expect(errors).toHaveLength(1);
        });

        it('rewrites the file at most once a minute while the source still answers a token that expires soon', async () => {
            // like IGithubApp.repositoryToken: the cached token until 5 minutes before its expiry
            let token = { password: 'cached-token-1', expiresAt: new Date(START + HOUR) };
            let issued = 1;
            const {
                manager, 
                provider, 
                clock, 
            } = setup({
                credentials: {
                    async get(request) {
                        if (request.path === '') return undefined;
                        if (clock.now().getTime() >= token.expiresAt.getTime() - 300_000) {
                            issued++;
                            token = { password: `cached-token-${issued}`, expiresAt: new Date(clock.now().getTime() + HOUR) };
                        }
                        return { username: 'x-access-token', ...token };
                    },
                },
            });
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            expect(installs(raw)).toHaveLength(1);

            clock.advance(HOUR - 540_000);
            for (let i = 0; i < 5; i++) await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(2);

            clock.advance(60_000);
            await workspace.exec(['true']);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(3);

            // past the source's own refresh: a fresh token, the next rewrite 50 minutes later
            clock.advance(180_000);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(4);
            expect(installs(raw)[3]!.options.stdin).toContain('cached-token-2');
            clock.advance(60_000);
            await workspace.exec(['true']);
            expect(installs(raw)).toHaveLength(4);
        });

        it('redacts the tokens an earlier process wrote into a workspace found again', async () => {
            const OLD = 'ghs_writtenByTheProcessBeforeTheRestart';
            const file = `https://github.com/octo/demo\tx-access-token\t${OLD}\n`;
            const {
                manager, 
                provider, 
                build, 
            } = setup({}, (argv) => (argv[0] === 'sh' && argv[2] === READ_CREDENTIALS_SCRIPT ? { stdout: file } : {}));
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            // a workspace this process created has no earlier file to read
            expect(raw.calls.filter((call) => call.argv[2] === READ_CREDENTIALS_SCRIPT)).toHaveLength(0);
            raw.files.set('/workspace/notes.txt', `token ${OLD}`);

            const found = await build().get('r1');
            await expect(found.readFile('/workspace/notes.txt')).resolves.toBe('token [redacted]');
            await expect(found.exec(['cat', 'notes.txt'])).resolves.toBeDefined();
            expect(raw.calls.filter((call) => call.argv[2] === READ_CREDENTIALS_SCRIPT)).toHaveLength(1);
        });

        it('learns the earlier tokens in tools mode too, before the first exec', async () => {
            const OLD = 'ghs_writtenByAnEarlierWorkspaceModeProcess';
            const file = `https://github.com/octo/demo\tx-access-token\t${OLD}\n`;
            const { manager, build } = setup({ credentialMode: 'tools' }, (argv) => {
                if (argv[0] === 'sh' && argv[2] === READ_CREDENTIALS_SCRIPT) return { stdout: file };
                if (argv[0] === 'cat') return { stdout: `leaked ${OLD}\n` };
                return {};
            });
            await manager.acquire('r1', { repo: 'octo/demo' });
            const found = await build().get('r1');
            await expect(found.exec(['cat', 'notes.txt'])).resolves.toMatchObject({ stdout: 'leaked [redacted]\n' });
        });

        it('installs nothing while no source answers and the workspace holds no credentials', async () => {
            const { manager, provider } = setup({ credentials: { get: async () => undefined } });
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            await workspace.exec(['true']);
            expect(installs(provider.workspaces.get(workspace.id)!)).toHaveLength(0);
        });

        it('clears the credentials an earlier process wrote once no source answers', async () => {
            let file = '';
            const {
                manager, 
                provider, 
                build, 
            } = setup(
                { credentials: { get: async () => undefined } },
                (argv, options) => {
                    if (argv[0] === 'sh' && argv[2] === READ_CREDENTIALS_SCRIPT) return { stdout: file };
                    if (isInstall(argv)) file = options.stdin ?? '';
                    return {};
                },
            );
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const raw = provider.workspaces.get(workspace.id)!;
            expect(installs(raw)).toHaveLength(0);

            // an earlier process with a source wrote a token; this one adopts the workspace
            file = 'https://github.com/octo/demo\tx-access-token\tghs_writtenByTheProcessBeforeTheRestart\n';
            const adopted = await build().get('r1');
            await adopted.exec(['true']);
            await adopted.exec(['true']);
            expect(installs(raw)).toHaveLength(1);
            expect(file).toBe('');
        });

        it('installs nothing in a workspace without a repository', async () => {
            const { manager, provider } = setup();
            const { workspace } = await manager.acquire('r1', {});
            await workspace.exec(['true']);
            expect(installs(provider.workspaces.get(workspace.id)!)).toHaveLength(0);
        });

        it('adds the host credential of a static token without a path', async () => {
            const { manager, provider } = setup({ credentials: staticGitCredentials([{ host: 'github.com', token: 'ghp_hosttoken' }]) });
            const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
            const [install] = installs(provider.workspaces.get(workspace.id)!);
            expect(install!.options.stdin).toBe('https://github.com/octo/demo\tx-access-token\tghp_hosttoken\n' +
                'https://github.com/\tx-access-token\tghp_hosttoken\n');
        });
    });

    it('installs nothing in credentialMode tools', async () => {
        const { manager, provider } = setup({ credentialMode: 'tools' });
        const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
        await workspace.exec(['true']);
        expect(installs(provider.workspaces.get(workspace.id)!)).toHaveLength(0);
    });

    it('redacts every issued credential from exec results, file reads and errors', async () => {
        let leak = '';
        const { manager } = setup({}, (argv) => (argv[0] === 'cat' ? { stdout: `token=${leak}\n`, stderr: `again ${leak}` } : {}));
        const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
        leak = 'write-token-2';

        const result = await workspace.exec(['cat', '/home/sandbox/.chamvi/credentials']);
        expect(result.stdout).toBe('token=[redacted]\n');
        expect(result.stderr).toBe('again [redacted]');
        expect(workspace.redact?.('a read-token-1 b')).toBe('a [redacted] b');

        expect(await manager.get('r1')).toBe(workspace);
        await workspace.writeFile('notes.txt', 'leaked write-token-2');
        await expect(workspace.readFile('notes.txt')).resolves.toBe('leaked [redacted]');
        await expect(workspace.readBytes('notes.txt')).resolves.toEqual(new TextEncoder().encode('leaked [redacted]'));

        const error = await workspace.readFile('missing-write-token-2').catch((e: unknown) => e);
        expect((error as Error).message).not.toContain('write-token-2');
        expect((error as Error).message).toContain('[redacted]');
    });

    it('hands out the provider\'s workspace itself without credentials', async () => {
        const clock = new ControllableClock(new Date(START));
        const provider = createFakeProvider({ clock });
        const manager = createWorkspaceManager({
            provider, 
            clock, 
            gcIntervalMs: 0, 
        });
        const { workspace } = await manager.acquire('r1', { repo: 'octo/demo' });
        expect(workspace).toBe(provider.workspaces.get(workspace.id));
    });

    it('sets the commit identity in the workspace environment', async () => {
        const { manager, provider } = setup({ author: { name: 'demo[bot]', email: '1+demo[bot]@users.noreply.github.com' }, env: { FOO: 'bar' } });
        await manager.acquire('r1', {});
        expect(provider.created[0]!.env).toEqual({
            FOO: 'bar',
            GIT_AUTHOR_NAME: 'demo[bot]',
            GIT_AUTHOR_EMAIL: '1+demo[bot]@users.noreply.github.com',
            GIT_COMMITTER_NAME: 'demo[bot]',
            GIT_COMMITTER_EMAIL: '1+demo[bot]@users.noreply.github.com',
        });
    });

    it('refuses bad options', () => {
        const provider = createFakeProvider();
        const bad: Array<Partial<WorkspaceManagerOptions>> = [
            { credentials: {} as IGitCredentials },
            { credentials: [null as unknown as IGitCredentials] },
            { credentialMode: 'env' as 'tools' },
            { depth: 0 },
            { author: { name: '', email: 'a@b' } },
            { author: { name: 'a\nb', email: 'a@b' } },
            { push: { mode: 'never' as 'auto' } },
        ];
        for (const options of bad) {
            expect(() => createWorkspaceManager({ provider, ...options })).toThrow(InvalidAgentDefinitionError);
        }
    });
});
