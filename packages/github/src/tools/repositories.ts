/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import { isObject } from 'smob';
import type { IGithubApp } from '../app/types.ts';
import { ISSUES_MAX, LABELS_MAX, REPOSITORIES_MAX } from './constants.ts';
import {
    REPO_PROPERTY,
    bindSignal,
    labelName,
    login,
    objectSchema,
    parseRepo,
    requireInteger,
    requireString,
    toolError,
    withOctokit,
} from './helpers.ts';
import type {
    GithubIssueList,
    GithubIssueSummary,
    GithubRepository,
    GithubRepositoryList,
} from './types.ts';

type ListIssuesInput = {
    repo: string;
    labels?: string[];
    limit?: number
};

function requireLabels(value: unknown): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (!Array.isArray(value) || value.length > LABELS_MAX) {
        throw new ValidationError(`labels must be a list of at most ${LABELS_MAX} label names.`);
    }

    return value.map((label) => {
        const name = requireString(label, 'labels[]');

        if (name.includes(',')) {
            throw new ValidationError('A label name for github_list_issues cannot hold a comma.');
        }

        return name;
    });
}

function toRepository(data: Record<string, unknown>, installationId: number, account: string): GithubRepository {
    return {
        repo: String(data.full_name),
        installationId,
        account,
        private: data.private === true,
        archived: data.archived === true,
        fork: data.fork === true,
        defaultBranch: typeof data.default_branch === 'string' ? data.default_branch : 'main',
        url: String(data.html_url),
    };
}

function toIssueSummary(data: Record<string, unknown>): GithubIssueSummary {
    return {
        number: Number(data.number),
        title: String(data.title),
        author: login(data.user),
        labels: Array.isArray(data.labels) ? data.labels.map(labelName).filter((name) => name.length > 0) : [],
        comments: typeof data.comments === 'number' ? data.comments : 0,
        createdAt: String(data.created_at),
        updatedAt: String(data.updated_at),
        url: String(data.html_url),
    };
}

/** `github_list_repositories` and `github_list_issues`. */
export function createRepositoryTools(app: IGithubApp): ToolSet {
    return {
        github_list_repositories: defineTool<{ includeArchived?: boolean }, GithubRepositoryList>({
            trust: { untrustedResult: true },
            description: 'List every repository the GitHub App is installed on, over all of its installations (accounts and organizations), sorted by name.',
            inputSchema: objectSchema({
                includeArchived: {
                    type: 'boolean',
                    description: 'Also list archived repositories (default false).',
                },
            }, ['includeArchived']),
            execute: async (input, { context }) => {
                if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') {
                    throw new ValidationError('includeArchived must be a boolean.');
                }

                const { signal } = context.run;

                try {
                    const installations = (await app.installations()).sort((a, b) => a.id - b.id);
                    const repositories: GithubRepository[] = [];

                    for (const installation of installations) {
                        signal.throwIfAborted();

                        // a suspended installation's token exchange answers 403
                        if (installation.suspended) {
                            continue;
                        }

                        const octokit = bindSignal(await app.octokit(installation.id), signal);
                        const items = await octokit.paginate('GET /installation/repositories', { per_page: 100 });

                        for (const item of items) {
                            if (!isObject(item)) {
                                continue;
                            }

                            const repository = toRepository(item, installation.id, installation.account);

                            if (repository.archived && input.includeArchived !== true) {
                                continue;
                            }

                            repositories.push(repository);
                        }
                    }

                    repositories.sort((a, b) => {
                        const left = a.repo.toLowerCase();
                        const right = b.repo.toLowerCase();

                        if (left === right) {
                            return 0;
                        }

                        return left < right ? -1 : 1;
                    });

                    return {
                        repositories: repositories.slice(0, REPOSITORIES_MAX),
                        truncated: repositories.length > REPOSITORIES_MAX,
                    };
                } catch (error) {
                    if (signal.aborted) {
                        throw signal.reason;
                    }

                    throw toolError(error);
                }
            },
        }),

        github_list_issues: defineTool<ListIssuesInput, GithubIssueList>({
            trust: { untrustedResult: true },
            description: 'List the open issues of a repository (pull requests left out), most recently updated first.',
            inputSchema: objectSchema({
                repo: REPO_PROPERTY,
                labels: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    maxItems: LABELS_MAX,
                    description: 'Only issues carrying every one of these labels.',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: ISSUES_MAX,
                    description: `How many issues to return (default ${ISSUES_MAX}).`,
                },
            }, ['labels', 'limit']),
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const labels = requireLabels(input.labels);
                const limit = input.limit === undefined ? ISSUES_MAX : requireInteger(input.limit, 'limit', 1, ISSUES_MAX);

                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const issues: GithubIssueSummary[] = [];
                    let truncated = false;
                    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/issues', {
                        owner,
                        repo,
                        state: 'open',
                        per_page: 100,
                        ...(labels ? { labels: labels.join(',') } : {}),
                    });

                    for await (const { data } of pages) {
                        for (const item of data) {
                            if (!isObject(item) || item.pull_request) {
                                continue;
                            }

                            if (issues.length === limit) {
                                truncated = true;

                                break;
                            }

                            issues.push(toIssueSummary(item));
                        }

                        if (truncated) {
                            break;
                        }
                    }

                    return { issues, truncated };
                });
            },
        }),
    };
}
