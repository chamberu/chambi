/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    InvalidRunStateError,
    SandboxError,
    ToolDeniedError,
    ValidationError,
} from '@chamvi/core';
import type {
    ApprovalDecision,
    ApprovalRequestInput,
    ChannelHandle,
    ToolContext,
} from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type {
    ExecResult,
    GitCredentialRequest,
    GitPushResult,
    GitToolResult,
    WorkspaceManagerOptions,
} from '@chamvi/sandbox';
import { GIT_AUTH_SCRIPT } from '../../../src/git/constants.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { callTool, toolContext } from '../../utils/context.ts';
import { createFakeProvider } from '../../utils/provider.ts';

const REPO = 'https://github.com/octo/demo.git';
const LOCAL = '1'.repeat(40);
const REMOTE = '2'.repeat(40);

type Remote = {
    /** The checked out branch; undefined: detached. */
    head?: string;
    /** Local branches. */
    local: string[];
    /** Remote-tracking refs known locally, e.g. `origin/feature`. */
    tracking: string[];
    push: Partial<ExecResult>;
    /** The answer of `ls-remote`; default the remote's HEAD: `main` for the workspace's repository, else `trunk`. */
    lsRemote?: Partial<ExecResult>;
};

/** The git arguments of an exec: after the auth script's `sh url origin path`, the reset `-c` pairs, or plain `git`. */
function gitArgs(argv: readonly string[]): string[] | undefined {
    if (argv[0] === 'sh' && argv[2] === GIT_AUTH_SCRIPT) return argv.slice(7);
    if (argv[0] !== 'git') return undefined;
    if (argv[1] === '-c' && argv[2] === 'credential.helper=') return argv.slice(5);
    return argv.slice(1);
}

function setup(options: Partial<WorkspaceManagerOptions> = {}, remote: Partial<Remote> = {}) {
    const state: Remote = {
        head: 'feature',
        local: ['feature', 'main'],
        tracking: ['origin/feature', 'origin/main'],
        push: {},
        ...remote,
    };
    const clock = new ControllableClock(new Date(1_000_000));
    const provider = createFakeProvider({
        clock,
        onExec(argv) {
            const args = gitArgs(argv);
            if (!args) return {};
            switch (args[0]) {
                case 'symbolic-ref':
                    return state.head ? { stdout: `${state.head}\n` } : { exitCode: 1 };
                case 'rev-parse': {
                    const ref = args.at(-1)!;
                    if (ref === 'HEAD') return { stdout: `${LOCAL}\n` };
                    if (ref.startsWith('refs/heads/')) return state.local.includes(ref.slice(11)) ? { stdout: `${LOCAL}\n` } : { exitCode: 1 };
                    if (ref.startsWith('refs/remotes/')) return state.tracking.includes(ref.slice(13)) ? { stdout: `${REMOTE}\n` } : { exitCode: 1 };
                    return { exitCode: 1 };
                }
                case 'rev-list':
                    return { stdout: '2\n' };
                case 'log':
                    return { stdout: 'abc1234 fix the build\ndef5678 bump deps\n' };
                case 'ls-remote':
                    return state.lsRemote ?? { stdout: `ref: refs/heads/${args.includes(REPO) ? 'main' : 'trunk'}\tHEAD\n${REMOTE}\tHEAD\n` };
                case 'push':
                    return state.push;
                default:
                    return {};
            }
        },
    });
    const requests: GitCredentialRequest[] = [];
    const manager = createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
        credentials: {
            async get(request) {
                requests.push(request);
                return { username: 'x-access-token', password: `${request.access}-secret-token` };
            },
        },
        ...options,
    });
    const tools = manager.tools();
    const create = async (runId = 'r1') => {
        const { workspace } = await manager.acquire(runId, { repo: 'octo/demo' });
        return provider.workspaces.get(workspace.id)!;
    };
    return {
        state,
        provider,
        manager,
        tools,
        requests,
        create,
        call: <T>(name: string, input: unknown, ctx: ToolContext = toolContext('r1')) => callTool<T>(tools, name, input, ctx),
    };
}

/** The git arguments of every exec after the checkout and credentials setup. */
function gitCalls(workspace: { calls: Array<{ argv: string[] }> }, from: number): string[][] {
    return workspace.calls.slice(from).map((call) => gitArgs(call.argv) ?? call.argv);
}

/** A context whose channels answer `handle` (for any name), recording the names asked for. */
function channelContext(handle: ChannelHandle | undefined, asked: Array<string | undefined>): ToolContext {
    const ctx = toolContext('r1');
    ctx.channels = {
        findOne(name) {
            asked.push(name);
            return handle;
        },
        findOneOrFail(name) {
            asked.push(name);
            if (!handle) throw new Error('no channel');
            return handle;
        },
        find: () => (handle ? [handle] : []),
    };
    return ctx;
}

function approvingHandle(decision: ApprovalDecision, requests: ApprovalRequestInput[]): ChannelHandle {
    return {
        name: 'github',
        emit: async () => undefined,
        async approve(request) {
            requests.push(request);
            return decision;
        },
    };
}

describe('git tools', () => {
    it('are part of the manager tools', () => {
        const { tools } = setup();
        expect(Object.keys(tools)).toEqual(expect.arrayContaining(['git_fetch', 'git_pull', 'git_push']));
    });

    describe('git_push', () => {
        it('pushes the current branch to the recorded URL with a write credential over stdin', async () => {
            const {
                create,
                call,
                requests,
            } = setup();
            const workspace = await create();
            const from = workspace.calls.length;
            const result = await call<GitPushResult>('git_push', {});
            const push = workspace.calls.find((entry) => gitArgs(entry.argv)?.[0] === 'push')!;
            expect(push.argv.slice(0, 7)).toEqual(['sh', '-c', GIT_AUTH_SCRIPT, 'sh', REPO, 'https://github.com', 'octo/demo']);
            expect(gitArgs(push.argv)).toEqual(['push', '--porcelain', REPO, `${LOCAL}:refs/heads/feature`]);
            expect(push.options.stdin).toBe('x-access-token\nwrite-secret-token\n');
            expect(requests.at(-1)).toMatchObject({
                access: 'write',
                path: 'octo/demo',
                runId: 'r1',
            });
            expect(gitCalls(workspace, from)).toContainEqual(['update-ref', 'refs/remotes/origin/feature', LOCAL]);
            expect(result).toMatchObject({
                workspace: workspace.id,
                remote: REPO,
                branch: 'feature',
                commit: LOCAL,
                pushed: true,
                forced: false,
                exitCode: 0,
            });
        });

        it('never names a remote of the repository config', async () => {
            const { create, call } = setup();
            const workspace = await create();
            const from = workspace.calls.length;
            await call('git_push', {});
            await call('git_fetch', {});
            for (const args of gitCalls(workspace, from)) {
                if (args[0] === 'push' || args[0] === 'fetch') expect(args).not.toContain('origin');
            }
        });

        it('refuses the default branch unless allowBranch allows it', async () => {
            const refused = setup({}, { head: 'main' });
            const workspace = await refused.create();
            await expect(refused.call('git_push', {})).rejects.toThrow(ToolDeniedError);
            expect(workspace.calls.some((entry) => gitArgs(entry.argv)?.[0] === 'push')).toBe(false);

            const allowed = setup({ push: { allowBranch: () => true } }, { head: 'main' });
            await allowed.create();
            await expect(allowed.call('git_push', {})).resolves.toMatchObject({ pushed: true, branch: 'main' });
        });

        it('reads the default branch of origin from the remote at push time, not from the model-writable record', async () => {
            const {
                create,
                call,
                provider,
            } = setup({}, { head: 'main' });
            const workspace = await create();
            // after a find(), info.defaultBranch comes from `git config chamvi.defaultBranch`, which bash can change
            (provider.workspaces.get(workspace.id)!.info as { defaultBranch?: string }).defaultBranch = 'scratch';
            await expect(call('git_push', {})).rejects.toThrow(ToolDeniedError);
            const lsRemote = workspace.calls.find((entry) => gitArgs(entry.argv)?.[0] === 'ls-remote');
            expect(gitArgs(lsRemote!.argv)).toEqual(['ls-remote', '--symref', REPO, 'HEAD']);
            expect(workspace.calls.some((entry) => gitArgs(entry.argv)?.[0] === 'push')).toBe(false);
        });

        it('refuses the push when the default branch of the remote cannot be read', async () => {
            for (const remote of [undefined, 'alice/demo']) {
                const { create, call } = setup({}, { head: 'main', lsRemote: { exitCode: 128, stderr: 'remote: API rate limit exceeded' } });
                const workspace = await create();
                await expect(call('git_push', remote === undefined ? {} : { remote })).rejects.toThrow(SandboxError);
                expect(workspace.calls.some((entry) => gitArgs(entry.argv)?.[0] === 'push')).toBe(false);
            }
        });

        it('asks allowBranch with the branch and the tool context', async () => {
            const asked: string[] = [];
            const { create, call } = setup({
                push: {
                    allowBranch: (branch, ctx) => {
                        asked.push(`${ctx.run.runId}:${branch}`);
                        return false;
                    },
                },
            });
            await create();
            await expect(call('git_push', { branch: 'feature' })).rejects.toThrow(ToolDeniedError);
            expect(asked).toEqual(['r1:feature']);
        });

        it('refuses a force push without allowForce and leases one with it', async () => {
            const refused = setup();
            await refused.create();
            await expect(refused.call('git_push', { force: true })).rejects.toThrow(ToolDeniedError);

            const forced = setup({ push: { allowForce: true } });
            const workspace = await forced.create();
            await expect(forced.call('git_push', { force: true })).resolves.toMatchObject({ forced: true });
            const push = workspace.calls.map((entry) => gitArgs(entry.argv)).find((args) => args?.[0] === 'push');
            expect(push).toEqual(['push', '--porcelain', `--force-with-lease=refs/heads/feature:${REMOTE}`, REPO, `${LOCAL}:refs/heads/feature`]);
        });

        it('leases a new branch as absent', async () => {
            const { create, call } = setup({ push: { allowForce: true } }, { local: ['main'], tracking: ['origin/main'] });
            const workspace = await create();
            await call('git_push', { branch: 'fix', force: true });
            const push = workspace.calls.map((entry) => gitArgs(entry.argv)).find((args) => args?.[0] === 'push');
            expect(push).toEqual(['push', '--porcelain', '--force-with-lease=refs/heads/fix:', REPO, `${LOCAL}:refs/heads/fix`]);
        });

        it('refuses a detached HEAD without a branch', async () => {
            const { create, call } = setup({}, { head: undefined });
            const workspace = await create();
            await expect(call('git_push', {})).rejects.toThrow(ValidationError);
            expect(workspace.calls.some((entry) => gitArgs(entry.argv)?.[0] === 'push')).toBe(false);
        });

        it('answers a refused push as a result, not an error', async () => {
            const { create, call } = setup({}, { push: { exitCode: 1, stderr: '! [rejected] feature (non-fast-forward)\nwrite-secret-token' } });
            const workspace = await create();
            const from = workspace.calls.length;
            const result = await call<GitPushResult>('git_push', {});
            expect(result).toMatchObject({ pushed: false, exitCode: 1 });
            expect(result.stderr).toBe('! [rejected] feature (non-fast-forward)\n[redacted]');
            expect(gitCalls(workspace, from).some((args) => args[0] === 'update-ref')).toBe(false);
        });

        it('sets the upstream of the local branch when asked', async () => {
            const { create, call } = setup();
            const workspace = await create();
            const from = workspace.calls.length;
            await call('git_push', { setUpstream: true });
            expect(gitCalls(workspace, from)).toEqual(expect.arrayContaining([
                ['config', 'branch.feature.remote', 'origin'],
                ['config', 'branch.feature.merge', 'refs/heads/feature'],
            ]));
        });

        it('pushes to another repository after its own checks, refusing its default branch', async () => {
            const { create, call } = setup({ allowRepo: (url) => !url.includes('mallory') });
            const workspace = await create();
            await expect(call('git_push', { remote: 'mallory/demo' })).rejects.toThrow(ValidationError);
            await expect(call('git_push', { remote: 'alice/demo', branch: 'trunk' })).rejects.toThrow(ToolDeniedError);
            await expect(call('git_push', { remote: 'alice/demo' })).resolves.toMatchObject({ remote: 'https://github.com/alice/demo.git', pushed: true });
            const push = workspace.calls.filter((entry) => gitArgs(entry.argv)?.[0] === 'push').at(-1)!;
            expect(push.argv.slice(4, 7)).toEqual(['https://github.com/alice/demo.git', 'https://github.com', 'alice/demo']);
        });

        describe('approve mode', () => {
            it('asks through the source channel with the commit list and pushes when approved', async () => {
                const { create, call } = setup({ push: { mode: 'approve' } });
                await create();
                const requests: ApprovalRequestInput[] = [];
                const asked: Array<string | undefined> = [];
                const ctx = channelContext(approvingHandle({ approved: true }, requests), asked);
                await expect(call('git_push', {}, ctx)).resolves.toMatchObject({ pushed: true });
                expect(asked).toEqual([undefined]);
                expect(requests).toEqual([{
                    title: 'Push 2 commits to feature',
                    body: `To ${REPO}:\nabc1234 fix the build\ndef5678 bump deps`,
                }]);
            });

            it('refuses the push when denied', async () => {
                const { create, call } = setup({ push: { mode: 'approve' } });
                const workspace = await create();
                const ctx = channelContext(approvingHandle({ approved: false, reason: 'not now' }, []), []);
                const error = await call('git_push', {}, ctx).catch((e: unknown) => e);
                expect(error).toBeInstanceOf(ToolDeniedError);
                expect((error as Error).message).toContain('not now');
                expect(workspace.calls.some((entry) => gitArgs(entry.argv)?.[0] === 'push')).toBe(false);
            });

            it('asks through push.channel when set', async () => {
                const { create, call } = setup({ push: { mode: 'approve', channel: 'openclaw' } });
                await create();
                const asked: Array<string | undefined> = [];
                await call('git_push', {}, channelContext(approvingHandle({ approved: true }, []), asked));
                expect(asked).toEqual(['openclaw']);
            });

            it('falls back to approve() without a source channel', async () => {
                const { create, call } = setup({ push: { mode: 'approve' } });
                await create();
                // outside an engine run there is no tool-call frame, which proves the inbox path was taken
                await expect(call('git_push', {}, channelContext(undefined, []))).rejects.toThrow(InvalidRunStateError);
            });
        });
    });

    describe('git_fetch', () => {
        it('fetches every branch of the recorded URL into origin with a read credential', async () => {
            const { create, call } = setup();
            const workspace = await create();
            const result = await call<GitToolResult>('git_fetch', {});
            const fetch = workspace.calls.find((entry) => gitArgs(entry.argv)?.[0] === 'fetch')!;
            expect(gitArgs(fetch.argv)).toEqual(['fetch', REPO, '+refs/heads/*:refs/remotes/origin/*']);
            expect(fetch.options.stdin).toBe('x-access-token\nread-secret-token\n');
            expect(result).toMatchObject({
                remote: REPO,
                exitCode: 0,
                refspec: '+refs/heads/*:refs/remotes/origin/*',
            });
        });

        it('maps a branch to its remote-tracking ref and passes a refspec as it is', async () => {
            const { create, call } = setup();
            await create();
            await expect(call('git_fetch', { refspec: 'main' })).resolves.toMatchObject({ refspec: '+refs/heads/main:refs/remotes/origin/main' });
            await expect(call('git_fetch', { refspec: 'refs/tags/v1:refs/tags/v1' })).resolves.toMatchObject({ refspec: 'refs/tags/v1:refs/tags/v1' });
        });

        it('fetches another repository into a remote named after it', async () => {
            const { create, call } = setup();
            await create();
            await expect(call('git_fetch', { remote: 'https://github.com/alice/demo' })).resolves.toMatchObject({
                remote: 'https://github.com/alice/demo',
                refspec: '+refs/heads/*:refs/remotes/alice/demo/*',
            });
            await expect(call('git_fetch', { remote: 'https://github.com/octo/demo/' })).resolves.toMatchObject({ refspec: '+refs/heads/*:refs/remotes/origin/*' });
        });

        it('refuses a refspec git would read as an option', async () => {
            const { create, call } = setup();
            await create();
            for (const refspec of ['--upload-pack=x', 'refs/heads/a..b', 'a b', 'refs/heads/x:refs/heads/y:z']) {
                await expect(call('git_fetch', { refspec })).rejects.toThrow(ValidationError);
            }
        });

        it('needs a remote in a workspace without a repository', async () => {
            const { manager, call } = setup();
            await manager.acquire('r1', {});
            await expect(call('git_fetch', {})).rejects.toThrow(ValidationError);
        });
    });

    describe('git_pull', () => {
        it('fetches the current branch and merges it', async () => {
            const { create, call } = setup();
            const workspace = await create();
            const from = workspace.calls.length;
            const result = await call<GitToolResult>('git_pull', {});
            const calls = gitCalls(workspace, from).filter((args) => args[0] === 'fetch' || args[0] === 'merge' || args[0] === 'rebase');
            expect(calls).toEqual([
                ['fetch', REPO, '+refs/heads/feature:refs/remotes/origin/feature'],
                ['merge', '--no-edit', 'refs/remotes/origin/feature'],
            ]);
            expect(result).toMatchObject({
                branch: 'feature',
                rebase: false,
                exitCode: 0,
            });
        });

        it('rebases onto another branch when asked', async () => {
            const { create, call } = setup();
            const workspace = await create();
            const from = workspace.calls.length;
            await call('git_pull', { branch: 'main', rebase: true });
            const calls = gitCalls(workspace, from).filter((args) => args[0] === 'fetch' || args[0] === 'merge' || args[0] === 'rebase');
            expect(calls).toEqual([
                ['fetch', REPO, '+refs/heads/main:refs/remotes/origin/main'],
                ['rebase', 'refs/remotes/origin/main'],
            ]);
        });

        it('needs a branch on a detached HEAD', async () => {
            const { create, call } = setup({}, { head: undefined });
            await create();
            await expect(call('git_pull', {})).rejects.toThrow(ValidationError);
        });
    });
});
