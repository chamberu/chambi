/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import {
    ToolDeniedError,
    ValidationError,
    defineEffectTool,
    effectMarker,
} from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import type { GithubMergeMethod, IGithubApp } from '../app/types.ts';
import { readChecks } from './checks.ts';
import {
    COMMIT_TITLE_MAX_CHARS,
    HEAD_PATTERN,
    ISSUE_TITLE_MAX_CHARS,
    MERGE_METHODS,
    MERGE_STATES,
    REF_PATTERN,
    SHA_PATTERN,
} from './constants.ts';
import {
    REPO_PROPERTY,
    inputEffectKey,
    numberSchema,
    objectSchema,
    parseRepo,
    requireInteger,
    requireRef,
    requireString,
    withOctokit,
} from './helpers.ts';
import { toPullRequest } from './pulls.ts';
import { createPullRequest, toCreated } from './pull-operation.ts';
import type {
    GithubCreatedPullRequest,
    GithubMergeResult,
    NumberInput,
    RepoInput,
} from './types.ts';

type CreatePullRequestInput = RepoInput & {
    head: string;
    base?: string;
    title: string;
    body: string;
    draft?: boolean;
};

type MergeInput = NumberInput & {
    sha: string;
    method?: GithubMergeMethod;
    commitTitle?: string;
    commitMessage?: string;
};

const HEAD = new RegExp(HEAD_PATTERN);
const SHA = new RegExp(SHA_PATTERN);

function requireSha(value: unknown): string {
    if (typeof value !== 'string' || !SHA.test(value)) {
        throw new ValidationError(`sha must be the head commit sha of the pull request, got ${JSON.stringify(value)}.`);
    }

    return value;
}

function requireMethod(value: unknown, fallback: GithubMergeMethod): GithubMergeMethod {
    if (value === undefined) {
        return fallback;
    }

    if (!(MERGE_METHODS as readonly unknown[]).includes(value)) {
        throw new ValidationError(`method must be one of ${MERGE_METHODS.join(', ')}.`);
    }

    return value as GithubMergeMethod;
}

function optionalString(value: unknown, name: string, max?: number): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    const text = requireString(value, name);

    if (max !== undefined && text.length > max) {
        throw new ValidationError(`${name} must have at most ${max} characters.`);
    }

    return text;
}

/** `branch` or `owner:branch`, as `owner:branch` (an unqualified head is a branch of the repository's owner). */
function requireHead(value: unknown, owner: string): string {
    const head = requireString(value, 'head');

    if (!HEAD.test(head) || head.includes('..')) {
        throw new ValidationError(`head must be a branch or "owner:branch" for a fork, got ${JSON.stringify(head)}.`);
    }

    return head.includes(':') ? head : `${owner}:${head}`;
}

/** `<runId>:github_create_pull_request:<sha256 of repo, head, base, title, body, draft>`. */
function pullRequestKey(input: CreatePullRequestInput, ctx: ToolContext): string {
    const { owner, repo } = parseRepo(input.repo);

    return inputEffectKey(ctx.run.runId, 'github_create_pull_request', [
        `${owner}/${repo}`.toLowerCase(),
        input.head,
        input.base ?? null,
        input.title,
        input.body,
        input.draft === true,
    ]);
}

/**
 * `github_create_pull_request` and `github_merge_pull_request`, which never
 * bypasses protection: it refuses (ToolDeniedError, before the merge
 * request) a closed pull request, a head that moved from `sha`, a draft,
 * unknown mergeability, a `mergeable_state` outside MERGE_STATES and any
 * required check that is not green or has not reported, so a token on a
 * bypass list merges nothing GitHub would block for others.
 */
export function createPullRequestWriteTools(app: IGithubApp, options: { mergeMethod: GithubMergeMethod }): ToolSet {
    return {
        github_create_pull_request: defineEffectTool<CreatePullRequestInput, GithubCreatedPullRequest>({
            trust: { guardWhenTainted: true },
            description: 'Open a pull request from a pushed branch (`branch`, or `owner:branch` for a fork) into `base` (default the repository\'s default branch). ' +
                'Applied at most once per run for the same input; GitHub refuses a second open pull request for the same head and base.',
            inputSchema: objectSchema<CreatePullRequestInput>({
                repo: REPO_PROPERTY,
                head: {
                    type: 'string',
                    pattern: HEAD_PATTERN,
                    description: 'The branch with the changes, or "owner:branch" for a fork.',
                },
                base: {
                    type: 'string',
                    pattern: REF_PATTERN,
                    description: 'The branch to merge into (default the repository\'s default branch).',
                },
                title: {
                    type: 'string',
                    minLength: 1,
                    maxLength: ISSUE_TITLE_MAX_CHARS,
                    description: 'The pull request title.',
                },
                body: {
                    type: 'string',
                    minLength: 1,
                    description: 'The description in GitHub Markdown.',
                },
                draft: {
                    type: 'boolean',
                    description: 'Open it as a draft (default false).',
                },
            }, ['base', 'draft']),
            effectKey: pullRequestKey,
            alreadyApplied: async (key, input, ctx) => {
                const { owner, repo } = parseRepo(input.repo);
                const head = requireHead(input.head, owner);
                const marker = effectMarker(key);

                return withOctokit(app, ctx, { owner, repo }, async (octokit) => {
                    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/pulls', {
                        owner,
                        repo,
                        state: 'all',
                        head,
                        per_page: 100,
                    });

                    for await (const { data } of pages) {
                        for (const pull of data) {
                            if (pull.body?.includes(marker)) {
                                return toCreated(pull);
                            }
                        }
                    }

                    return undefined;
                });
            },
            execute: async (input, options) => {
                const { owner, repo } = parseRepo(input.repo);

                requireHead(input.head, owner);

                const title = requireString(input.title, 'title');
                const body = requireString(input.body, 'body');
                const given = input.base === undefined ? undefined : requireRef(input.base, 'base');

                if (input.draft !== undefined && typeof input.draft !== 'boolean') {
                    throw new ValidationError('draft must be a boolean.');
                }

                const marker = effectMarker(pullRequestKey(input, options.context));

                return withOctokit(app, options.context, { owner, repo }, async (octokit) => createPullRequest(octokit, { owner, repo }, {
                    head: input.head,
                    base: given,
                    title,
                    body: `${body}\n\n${marker}`,
                    draft: input.draft === true,
                }));
            },
        }),

        github_merge_pull_request: defineEffectTool<MergeInput, GithubMergeResult>({
            trust: { guardWhenTainted: true },
            description: 'Merge a pull request at the head commit you checked (`sha`, from github_get_pull_request or github_get_pull_request_checks). ' +
                'Refused while the head moved, it is a draft or closed, GitHub has not computed its mergeability, it conflicts, is blocked or behind, ' +
                'a required check is not green or has not reported yet, the required checks cannot be read, no check reported at all, ' +
                'or any check is still running. A failing check that is not required does not stop it. Never bypasses branch protection.',
            inputSchema: numberSchema<MergeInput>('pull request', {
                sha: {
                    type: 'string',
                    pattern: SHA_PATTERN,
                    description: 'The head commit sha the checks were read for.',
                },
                method: {
                    type: 'string',
                    enum: [...MERGE_METHODS],
                    description: `How to merge (default ${options.mergeMethod}).`,
                },
                commitTitle: {
                    type: 'string',
                    minLength: 1,
                    maxLength: COMMIT_TITLE_MAX_CHARS,
                    description: 'The merge commit title (default GitHub\'s).',
                },
                commitMessage: {
                    type: 'string',
                    minLength: 1,
                    description: 'The merge commit message (default GitHub\'s).',
                },
            }, ['method', 'commitTitle', 'commitMessage']),
            alreadyApplied: async (_key, input, ctx) => {
                const { owner, repo } = parseRepo(input.repo);
                const pullNumber = requireInteger(input.number, 'number', 1);
                const sha = requireSha(input.sha);
                const method = requireMethod(input.method, options.mergeMethod);

                return withOctokit(app, ctx, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                        owner,
                        repo,
                        pull_number: pullNumber,
                    });
                    const pull = toPullRequest(data as unknown as Record<string, unknown>);

                    if (!pull.merged || pull.headSha !== sha) {
                        return undefined;
                    }

                    return {
                        number: pull.number,
                        sha: pull.mergeCommitSha ?? sha,
                        method,
                        alreadyMerged: true,
                    };
                });
            },
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const pullNumber = requireInteger(input.number, 'number', 1);
                const sha = requireSha(input.sha);
                const method = requireMethod(input.method, options.mergeMethod);
                const commitTitle = optionalString(input.commitTitle, 'commitTitle', COMMIT_TITLE_MAX_CHARS);
                const commitMessage = optionalString(input.commitMessage, 'commitMessage');

                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                        owner,
                        repo,
                        pull_number: pullNumber,
                    });
                    const pull = toPullRequest(data as unknown as Record<string, unknown>);
                    const n = pull.number;

                    if (pull.merged && pull.headSha === sha) {
                        return {
                            number: n,
                            sha: pull.mergeCommitSha ?? sha,
                            method,
                            alreadyMerged: true,
                        };
                    }

                    if (pull.merged || pull.state !== 'open') {
                        throw new ToolDeniedError(`Pull request #${n} is ${pull.merged ? 'merged' : 'closed'}.`);
                    }

                    if (pull.headSha !== sha) {
                        throw new ToolDeniedError(`The head of #${n} moved to ${pull.headSha}; read its checks again.`);
                    }

                    if (pull.draft) {
                        throw new ToolDeniedError(`#${n} is a draft.`);
                    }

                    if (pull.mergeable === null) {
                        throw new ToolDeniedError(`GitHub is still computing whether #${n} can merge; read it again in a minute.`);
                    }

                    if (!pull.mergeable || !(MERGE_STATES as readonly string[]).includes(pull.mergeableState)) {
                        throw new ToolDeniedError(`#${n} cannot merge: mergeable_state is ${pull.mergeableState}.`);
                    }

                    const checks = await readChecks(octokit, { owner, repo }, {
                        number: n,
                        headSha: pull.headSha,
                        base: pull.base,
                    });

                    // fail closed: a token that cannot read the protection may be on its bypass list
                    if (!checks.required.known) {
                        throw new ToolDeniedError(`The required checks of ${pull.base} could not be read (branch protection or rulesets); #${n} must be merged by hand.`);
                    }

                    const notGreen = [
                        ...checks.checks.filter((check) => check.required && check.outcome !== 'success').map((check) => check.name),
                        ...checks.required.missing,
                    ];

                    if (notGreen.length > 0) {
                        throw new ToolDeniedError(`#${n} has required checks that are not green: ${[...new Set(notGreen)].join(', ')}.`);
                    }

                    // CI has not reported yet (a push seconds ago), or has not finished
                    if (checks.state === 'none') {
                        throw new ToolDeniedError(`#${n} has no checks reported yet; read its checks again once CI ran.`);
                    }

                    const running = checks.checks.filter((check) => check.outcome === 'pending').map((check) => check.name);

                    if (running.length > 0) {
                        throw new ToolDeniedError(`#${n} has checks that are still running: ${[...new Set(running)].join(', ')}.`);
                    }

                    // only these fields: nothing that asks GitHub to bypass protection
                    const { data: merged } = await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
                        owner,
                        repo,
                        pull_number: n,
                        sha,
                        merge_method: method,
                        ...(commitTitle ? { commit_title: commitTitle } : {}),
                        ...(commitMessage ? { commit_message: commitMessage } : {}),
                    });

                    return {
                        number: n,
                        sha: merged.sha,
                        method,
                        alreadyMerged: false,
                    };
                });
            },
        }),
    };
}
