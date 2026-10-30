/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { defineTool } from '@chamvi/core';
import { isObject } from 'smob';
import type { IGithubApp } from '../app/types.ts';
import { readChecks } from './checks.ts';
import { PULL_REQUESTS_MAX, REF_PATTERN } from './constants.ts';
import {
    REPO_PROPERTY,
    labelName,
    login,
    numberSchema,
    objectSchema,
    parseRepo,
    requireInteger,
    requireRef,
    withOctokit,
} from './helpers.ts';
import type {
    GithubPullRequest,
    GithubPullRequestChecks,
    GithubPullRequestList,
    GithubPullRequestSummary,
    GithubPushTarget,
    NumberInput,
} from './types.ts';

type ListPullRequestsInput = {
    repo: string;
    base?: string;
    limit?: number
};

function record(value: unknown): Record<string, unknown> {
    return isObject(value) ? value : {};
}

function stringOr<T>(value: unknown, fallback: T): string | T {
    return typeof value === 'string' ? value : fallback;
}

/** The head and base facts a summary and the full pull request share. */
function headOf(data: Record<string, unknown>) {
    const head = record(data.head);
    const base = record(data.base);
    const headRepo = isObject(head.repo) ? stringOr(head.repo.full_name, null) : null;
    const baseRepo = isObject(base.repo) ? stringOr(base.repo.full_name, null) : null;

    return {
        base: stringOr(base.ref, ''),
        head: stringOr(head.ref, ''),
        headSha: stringOr(head.sha, ''),
        headRepo,
        fork: headRepo === null || baseRepo === null || headRepo.toLowerCase() !== baseRepo.toLowerCase(),
    };
}

function authorTypeOf(user: unknown): string | null {
    return isObject(user) && typeof user.type === 'string' ? user.type : null;
}

function labelsOf(labels: unknown): string[] {
    return Array.isArray(labels) ? labels.map(labelName).filter((name) => name.length > 0) : [];
}

/** A `GET /repos/{owner}/{repo}/pulls/{n}` body as the slim GithubPullRequest. */
export function toPullRequest(data: Record<string, unknown>): GithubPullRequest {
    const facts = headOf(data);

    return {
        number: Number(data.number),
        title: String(data.title),
        body: stringOr(data.body, null),
        state: String(data.state),
        draft: data.draft === true,
        merged: data.merged === true,
        base: facts.base,
        head: facts.head,
        author: login(data.user),
        url: String(data.html_url),
        changedFiles: typeof data.changed_files === 'number' ? data.changed_files : 0,
        headSha: facts.headSha,
        headRepo: facts.headRepo,
        fork: facts.fork,
        authorType: authorTypeOf(data.user),
        labels: labelsOf(data.labels),
        mergeable: typeof data.mergeable === 'boolean' ? data.mergeable : null,
        mergeableState: typeof data.mergeable_state === 'string' && data.mergeable_state.length > 0 ? data.mergeable_state : 'unknown',
        maintainerCanModify: data.maintainer_can_modify === true,
        mergeCommitSha: stringOr(data.merge_commit_sha, null),
    };
}

function toPullRequestSummary(data: Record<string, unknown>): GithubPullRequestSummary {
    const facts = headOf(data);

    return {
        number: Number(data.number),
        title: String(data.title),
        author: login(data.user),
        authorType: authorTypeOf(data.user),
        draft: data.draft === true,
        base: facts.base,
        head: facts.head,
        headSha: facts.headSha,
        headRepo: facts.headRepo,
        fork: facts.fork,
        labels: labelsOf(data.labels),
        createdAt: String(data.created_at),
        updatedAt: String(data.updated_at),
        url: String(data.html_url),
    };
}

function permissionOf(value: unknown): 'read' | 'write' | null {
    return value === 'read' || value === 'write' ? value : null;
}

/** `github_list_pull_requests`, `github_get_pull_request_checks`, `github_get_push_target`. */
export function createPullRequestTools(app: IGithubApp): ToolSet {
    return {
        github_list_pull_requests: defineTool<ListPullRequestsInput, GithubPullRequestList>({
            trust: { untrustedResult: true },
            description: 'List the open pull requests of a repository with author and its type, head sha and repository (fork or not) and labels.',
            inputSchema: objectSchema({
                repo: REPO_PROPERTY,
                base: {
                    type: 'string',
                    pattern: REF_PATTERN,
                    description: 'Only pull requests into this base branch.',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: PULL_REQUESTS_MAX,
                    description: `How many pull requests to return (default ${PULL_REQUESTS_MAX}).`,
                },
            }, ['base', 'limit']),
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const base = input.base === undefined ? undefined : requireRef(input.base, 'base');
                const limit = input.limit === undefined ? PULL_REQUESTS_MAX : requireInteger(input.limit, 'limit', 1, PULL_REQUESTS_MAX);

                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const pullRequests: GithubPullRequestSummary[] = [];
                    let truncated = false;
                    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/pulls', {
                        owner,
                        repo,
                        state: 'open',
                        per_page: 100,
                        ...(base ? { base } : {}),
                    });

                    for await (const { data } of pages) {
                        for (const item of data) {
                            if (pullRequests.length === limit) {
                                truncated = true;

                                break;
                            }

                            pullRequests.push(toPullRequestSummary(item as unknown as Record<string, unknown>));
                        }

                        if (truncated) {
                            break;
                        }
                    }

                    return { pullRequests, truncated };
                });
            },
        }),

        github_get_pull_request_checks: defineTool<NumberInput, GithubPullRequestChecks>({
            trust: { untrustedResult: true },
            description: 'Read the checks of a pull request\'s head commit (check runs and commit statuses) with the required ones of the base branch. ' +
                'state is none while nothing reported yet and pending while a check runs or a required check has not reported; only success means green.',
            inputSchema: numberSchema('pull request'),
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const pullNumber = requireInteger(input.number, 'number', 1);

                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                        owner,
                        repo,
                        pull_number: pullNumber,
                    });
                    const pull = toPullRequest(data as unknown as Record<string, unknown>);

                    return readChecks(octokit, { owner, repo }, {
                        number: pull.number,
                        headSha: pull.headSha,
                        base: pull.base,
                    });
                });
            },
        }),

        github_get_push_target: defineTool<NumberInput, GithubPushTarget>({
            trust: { untrustedResult: true },
            description: 'Whether the GitHub App can push fix commits onto a pull request\'s head branch: the head repository, ' +
                'the App\'s installation and permissions there. A fork the App is not installed on is never pushable; open a pull request of your own instead.',
            inputSchema: numberSchema('pull request'),
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const pullNumber = requireInteger(input.number, 'number', 1);

                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                        owner,
                        repo,
                        pull_number: pullNumber,
                    });
                    const pull = toPullRequest(data as unknown as Record<string, unknown>);
                    const target: GithubPushTarget = {
                        number: pull.number,
                        headRepo: pull.headRepo,
                        headBranch: pull.head,
                        headSha: pull.headSha,
                        fork: pull.fork,
                        installationId: null,
                        contents: null,
                        workflows: null,
                        maintainerCanModify: pull.maintainerCanModify,
                        canPush: false,
                        reason: null,
                    };

                    if (pull.headRepo === null) {
                        return { ...target, reason: 'head repository deleted' };
                    }

                    const head = parseRepo(pull.headRepo);
                    const installation = await app.repositoryInstallation(head);

                    if (installation === undefined) {
                        return { ...target, reason: `GitHub App not installed on ${pull.headRepo}` };
                    }

                    const installationId = installation.id;
                    const contents = permissionOf(installation.permissions.contents);
                    const workflows = permissionOf(installation.permissions.workflows);
                    const canPush = contents === 'write';

                    return {
                        ...target,
                        installationId,
                        contents,
                        workflows,
                        canPush,
                        reason: canPush ? null : 'installation has no contents write',
                    };
                });
            },
        }),
    };
}
