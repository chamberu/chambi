/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import {
    SandboxError,
    ToolDeniedError,
    ValidationError,
    approve,
    defineTool,
} from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import type { GitAccess } from '../credentials/types.ts';
import { credentialKey, urlRepoPath } from '../git/helpers.ts';
import { runGit } from '../git/module.ts';
import { isGitRef, parseDefaultBranch } from '../repo/helpers.ts';
import type { ExecResult, IWorkspace } from '../workspace/types.ts';
import { PUSH_LOG_MAX_COMMITS } from './constants.ts';
import {
    inputObject,
    optionalBoolean,
    optionalObjectSchema,
    optionalString,
} from './helpers.ts';
import type {
    GitFetchResult,
    GitPullResult,
    GitPushResult,
    GitToolResult,
    GitToolsContext,
} from './types.ts';

/** A full refspec: `[+]refs/...[:refs/...]`, no option, no `..`, `@{` or whitespace. */
const REFSPEC_PATTERN = /^\+?refs\/[\w./*+-]+(:refs\/[\w./*+-]+)?$/;

type Target = {
    workspace: IWorkspace;
    url: string;
    isOrigin: boolean;
    /** `origin` for the workspace's own repository, else the repository path. */
    name: string;
};

function workspaceSchema() {
    return {
        type: 'string' as const,
        minLength: 1,
        description: 'The workspace id from create_workspace; omit it when the run holds only one.',
    };
}

const REMOTE_SCHEMA = {
    type: 'string' as const,
    minLength: 1,
    description: 'Another repository ("owner/name" or an https URL), e.g. the head repository of a fork; default the workspace\'s repository.',
};

/** The remote-tracking name of a repository other than the workspace's own: its path with safe characters only. */
function remoteName(url: string): string {
    const name = urlRepoPath(url)
        .split('/')
        .map((segment) => segment.replace(/[^\w.-]/g, '-').replace(/^\.+/, '').replace(/\.lock$/, '-lock'))
        .filter((segment) => segment.length > 0)
        .join('/')
        .replaceAll('..', '-');

    return name.length > 0 ? name : 'remote';
}

function requireBranch(value: unknown, name = 'branch'): string | undefined {
    const branch = optionalString(value, name);

    if (branch !== undefined && !isGitRef(branch)) {
        throw new ValidationError(`${name} must be a branch name (letters, digits and . _ / + -, starting with a letter or digit).`);
    }

    return branch;
}

function toResult(target: Target, result: ExecResult): GitToolResult {
    return {
        workspace: target.workspace.id,
        remote: target.url,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
    };
}

/**
 * `git_fetch`, `git_pull` and `git_push`: every remote call runs with the
 * repository URL on the command line (never `remote.*.url`, which the
 * repository or the model can rewrite), the credential looked up for that
 * URL over stdin, every configured helper reset and hooks off. Plain tools:
 * fetching or pushing the same commit again changes nothing, and a moved
 * remote refuses a stale push.
 */
export function createGitTools(context: GitToolsContext): ToolSet {
    const {
        manager,
        lookup,
        normalize,
        push: policy,
    } = context;

    const target = async (body: Record<string, unknown>, ctx: ToolContext, tool: string): Promise<Target> => {
        const workspace = await manager.get(ctx.run.runId, optionalString(body.workspace, 'workspace'));
        const remote = optionalString(body.remote, 'remote');
        const own = workspace.info.repo;

        if (remote === undefined) {
            if (own === undefined) {
                throw new ValidationError(`${tool} needs a remote: workspace ${workspace.id} has no repository.`);
            }

            return {
                workspace,
                url: own,
                isOrigin: true,
                name: 'origin',
            };
        }

        const url = normalize(remote);
        // the same repository spelled with or without .git or a trailing slash is still origin
        const isOwn = own !== undefined && credentialKey(url) === credentialKey(own);

        return {
            workspace,
            url,
            isOrigin: isOwn,
            name: isOwn ? 'origin' : remoteName(url),
        };
    };

    const local = async (workspace: IWorkspace, args: string[], signal?: AbortSignal): Promise<ExecResult> => workspace.exec(['git', ...args], { signal });

    const revParse = async (workspace: IWorkspace, ref: string, signal?: AbortSignal): Promise<string | undefined> => {
        const result = await local(workspace, ['rev-parse', '-q', '--verify', ref], signal);
        const sha = result.stdout.trim();

        return result.exitCode === 0 && sha.length > 0 ? sha : undefined;
    };

    const currentBranch = async (workspace: IWorkspace, tool: string, signal?: AbortSignal): Promise<string> => {
        const result = await local(workspace, ['symbolic-ref', '-q', '--short', 'HEAD'], signal);
        const branch = result.stdout.trim();

        if (result.exitCode !== 0 || !isGitRef(branch)) {
            throw new ValidationError(`HEAD is detached (a tag or commit is checked out); pass branch to ${tool}, or switch to a branch first.`);
        }

        return branch;
    };

    const remoteGit = async (t: Target, access: GitAccess, args: string[], signal?: AbortSignal): Promise<ExecResult> => {
        const credential = await lookup(t.url, access, t.workspace.info.runId, signal);

        return runGit(t.workspace, {
            url: t.url,
            args,
            ...(credential && { credential }),
            ...(signal && { signal }),
        });
    };

    /**
     * The default branch of the remote, read from it at push time (never
     * `info.defaultBranch`, which a found workspace reads back from the
     * model-writable repository config). SandboxError when it cannot be read,
     * so the default-branch rule fails closed.
     */
    const defaultBranchOf = async (t: Target, signal?: AbortSignal): Promise<string> => {
        const result = await remoteGit(t, 'read', ['ls-remote', '--symref', t.url, 'HEAD'], signal);
        const branch = result.exitCode === 0 && !result.timedOut ? parseDefaultBranch(result.stdout) : undefined;

        if (branch === undefined) {
            const detail = result.stderr.trim().slice(0, 500);
            throw new SandboxError(`git_push could not read the default branch of ${t.url}, so it does not push${detail ? `: ${detail}` : '.'} Try again later.`);
        }

        return branch;
    };

    const fetchRefspec = (t: Target, refspec: string | undefined): string => {
        if (refspec === undefined) {
            return `+refs/heads/*:refs/remotes/${t.name}/*`;
        }

        if (REFSPEC_PATTERN.test(refspec) && !refspec.includes('..') && !refspec.includes('@{')) {
            return refspec;
        }

        if (isGitRef(refspec)) {
            return `+refs/heads/${refspec}:refs/remotes/${t.name}/${refspec}`;
        }

        throw new ValidationError('refspec must be a branch name or a refspec like "refs/tags/v1:refs/tags/v1".');
    };

    const askApproval = async (ctx: ToolContext, title: string, body: string): Promise<void> => {
        const handle = policy.channel === undefined ? ctx.channels.findOne() : ctx.channels.findOneOrFail(policy.channel);
        const decision = handle ? await handle.approve({ title, body }) : await approve(ctx, { title, body });

        if (!decision.approved) {
            throw new ToolDeniedError(`The push was denied${decision.reason ? `: ${decision.reason}` : '.'}`);
        }
    };

    return {
        git_fetch: defineTool<{
            remote?: string;
            refspec?: string;
            workspace?: string
        }, GitFetchResult>({
            description: 'Fetch from the workspace\'s repository (or another one) with the run\'s git credentials. ' +
                'Default: every branch into origin/<branch>; a branch name fetches only that branch. ' +
                'Use it instead of git fetch in bash, which has no credentials for private repositories.',
            inputSchema: optionalObjectSchema({
                remote: REMOTE_SCHEMA,
                refspec: {
                    type: 'string',
                    minLength: 1,
                    description: 'A branch name, or a refspec like "refs/tags/v1:refs/tags/v1". Another repository\'s branches land in <owner>/<name>/<branch>.',
                },
                workspace: workspaceSchema(),
            }),
            trust: {
                taint: true,
                guardWhenTainted: async (input, ctx) => !(await target(inputObject(input), ctx, 'git_fetch')).isOrigin,
            },
            execute: async (input, { context: ctx }) => {
                const body = inputObject(input);
                const refspec = optionalString(body.refspec, 'refspec');
                const t = await target(body, ctx, 'git_fetch');
                const spec = fetchRefspec(t, refspec);
                const result = await remoteGit(t, 'read', ['fetch', t.url, spec], ctx.run.signal);

                return { ...toResult(t, result), refspec: spec };
            },
        }),

        git_pull: defineTool<{
            remote?: string;
            branch?: string;
            rebase?: boolean;
            workspace?: string;
        }, GitPullResult>({
            description: 'Fetch a branch (default: the current one) and merge it into the current branch, or rebase onto it with rebase: true. ' +
                'Conflicts come back in the result; resolve them, then commit (or git rebase --continue) in bash.',
            inputSchema: optionalObjectSchema({
                remote: REMOTE_SCHEMA,
                branch: {
                    type: 'string',
                    minLength: 1,
                    description: 'The remote branch, e.g. the base branch to update onto. Default: the current branch.',
                },
                rebase: { type: 'boolean', description: 'Rebase the current branch onto it instead of merging. Default false.' },
                workspace: workspaceSchema(),
            }),
            trust: {
                taint: true,
                guardWhenTainted: async (input, ctx) => !(await target(inputObject(input), ctx, 'git_pull')).isOrigin,
            },
            execute: async (input, { context: ctx }) => {
                const body = inputObject(input);
                const rebase = optionalBoolean(body.rebase, 'rebase') ?? false;
                const requested = requireBranch(body.branch);
                const t = await target(body, ctx, 'git_pull');
                const { signal } = ctx.run;
                const branch = requested ?? await currentBranch(t.workspace, 'git_pull', signal);
                const tracking = `refs/remotes/${t.name}/${branch}`;

                const fetched = await remoteGit(t, 'read', ['fetch', t.url, `+refs/heads/${branch}:${tracking}`], signal);

                if (fetched.exitCode !== 0 || fetched.timedOut) {
                    return {
                        ...toResult(t, fetched),
                        branch,
                        rebase,
                        step: 'fetch',
                    };
                }

                const merged = await local(t.workspace, rebase ? ['rebase', tracking] : ['merge', '--no-edit', tracking], signal);

                return {
                    ...toResult(t, merged),
                    branch,
                    rebase,
                    step: rebase ? 'rebase' : 'merge',
                };
            },
        }),

        git_push: defineTool<{
            remote?: string;
            branch?: string;
            force?: boolean;
            setUpstream?: boolean;
            workspace?: string;
        }, GitPushResult>({
            trust: { guardWhenTainted: true },
            description: 'Push a branch (default: the current one) to the workspace\'s repository with the run\'s git credentials. ' +
                'A rejected push (the remote moved) comes back with pushed: false; fetch and merge or rebase, then push again. ' +
                'The repository\'s default branch is refused unless the operator allows it.',
            inputSchema: optionalObjectSchema({
                remote: REMOTE_SCHEMA,
                branch: {
                    type: 'string',
                    minLength: 1,
                    description: 'The branch to push to; its local branch is pushed when it exists, else HEAD. Default: the current branch.',
                },
                force: {
                    type: 'boolean',
                    description: 'Overwrite the remote branch (after a rebase), always as --force-with-lease. Only when the operator allows force pushes.',
                },
                setUpstream: { type: 'boolean', description: 'Make origin/<branch> the upstream of the local branch.' },
                workspace: workspaceSchema(),
            }),
            execute: async (input, { context: ctx }) => {
                const body = inputObject(input);
                const force = optionalBoolean(body.force, 'force') ?? false;
                const setUpstream = optionalBoolean(body.setUpstream, 'setUpstream') ?? false;
                const requested = requireBranch(body.branch);
                const t = await target(body, ctx, 'git_push');
                const { signal } = ctx.run;
                const branch = requested ?? await currentBranch(t.workspace, 'git_push', signal);

                if (force && !policy.allowForce) {
                    throw new ToolDeniedError('Force pushes are not allowed here; merge the remote branch instead of rebasing (git_pull without rebase), then push.');
                }

                const allowed = policy.allowBranch ?
                    await policy.allowBranch(branch, ctx) :
                    branch !== await defaultBranchOf(t, signal);

                if (!allowed) {
                    throw new ToolDeniedError(`Pushing to ${branch} is not allowed here; push to another branch (e.g. git_push({ branch: "fix/..." })).`);
                }

                const ownBranch = await revParse(t.workspace, `refs/heads/${branch}`, signal);
                const commit = ownBranch ?? await revParse(t.workspace, 'HEAD', signal);

                if (commit === undefined) {
                    throw new ValidationError('There is no commit to push yet; commit first.');
                }

                const tracking = `refs/remotes/${t.name}/${branch}`;
                const lease = await revParse(t.workspace, tracking, signal);

                if (policy.mode === 'approve') {
                    const range = lease === undefined ? [commit, '--not', '--remotes'] : [commit, `^${lease}`];
                    const count = Number.parseInt((await local(t.workspace, ['rev-list', '--count', ...range], signal)).stdout.trim(), 10) || 0;
                    const log = (await local(t.workspace, ['log', '--format=%h %s', '-n', String(PUSH_LOG_MAX_COMMITS), ...range], signal)).stdout.trim();
                    const title = `Push ${count} commit${count === 1 ? '' : 's'} to ${branch}`;

                    await askApproval(ctx, title, `To ${t.url}:\n${log || '(no new commits)'}`);
                }

                const args = ['push', '--porcelain'];

                if (force) {
                    args.push(`--force-with-lease=refs/heads/${branch}:${lease ?? ''}`);
                }

                args.push(t.url, `${commit}:refs/heads/${branch}`);

                const result = await remoteGit(t, 'write', args, signal);
                const pushed = result.exitCode === 0 && !result.timedOut;

                if (pushed) {
                    // what a push to a named remote does: the next push leases against it
                    await local(t.workspace, ['update-ref', tracking, commit], signal);

                    if (setUpstream && ownBranch !== undefined && t.name === 'origin') {
                        await local(t.workspace, ['config', `branch.${branch}.remote`, 'origin'], signal);
                        await local(t.workspace, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`], signal);
                    }
                }

                return {
                    ...toResult(t, result),
                    branch,
                    commit,
                    pushed,
                    forced: force,
                };
            },
        }),
    };
}
