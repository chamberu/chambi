/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolExecutionOptions, ToolSet } from 'ai';
import { ValidationError, defineEffectTool, effectMarker } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import { isSameLogin } from '../app/helpers.ts';
import type { IGithubApp } from '../app/types.ts';
import { ISSUE_TITLE_MAX_CHARS, LABELS_MAX } from './constants.ts';
import {
    REPO_PROPERTY,
    inputEffectKey,
    numberSchema,
    objectSchema,
    parseRepo,
    reconcileSince,
    requireInteger,
    requireString,
    stepOf,
    withOctokit,
} from './helpers.ts';
import type {
    GithubClosedIssue,
    GithubComment,
    GithubCreatedIssue,
    GithubIssueLabels,
    NumberInput,
    RepoInput,
} from './types.ts';

type CommentInput = NumberInput & { body: string };
type LabelsInput = NumberInput & { labels: string[] };
type CloseInput = NumberInput & { reason?: 'completed' | 'not_planned' };
type IssueInput = RepoInput & {
    title: string; 
    body: string; 
    labels?: string[] 
};


const CLOSE_REASONS = ['completed', 'not_planned'];

/**
 * `<runId>:github_create_comment:<owner>/<repo>#<n>:<step>`: one comment per
 * issue per model step. Owner and repo are lower-cased, since GitHub
 * resolves them case-insensitively (`Octo/Demo` is `octo/demo`).
 */
function commentKey(input: CommentInput, ctx: ToolContext, options: Pick<ToolExecutionOptions<unknown>, 'toolCallId' | 'messages'>): string {
    const { owner, repo } = parseRepo(input.repo);
    const issueNumber = requireInteger(input.number, 'number', 1);
    return `${ctx.run.runId}:github_create_comment:${owner.toLowerCase()}/${repo.toLowerCase()}#${issueNumber}:${stepOf(options)}`;
}

/** `<runId>:github_create_issue:<sha256 of repo, title, body, labels>`: one issue per run and input. */
function issueKey(input: IssueInput, ctx: ToolContext): string {
    const { owner, repo } = parseRepo(input.repo);
    return inputEffectKey(ctx.run.runId, 'github_create_issue', [`${owner}/${repo}`.toLowerCase(), input.title, input.body, input.labels ?? []]);
}

function requireLabels(value: unknown): string[] {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > LABELS_MAX ||
        value.some((label) => typeof label !== 'string' || label.length === 0)
    ) {
        throw new ValidationError(`labels must be 1 to ${LABELS_MAX} non-empty strings.`);
    }
    return value as string[];
}

function requireReason(value: unknown): CloseInput['reason'] {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !CLOSE_REASONS.includes(value)) {
        throw new ValidationError(`reason must be one of ${CLOSE_REASONS.join(', ')}.`);
    }
    return value as CloseInput['reason'];
}

/**
 * The GitHub write tools, each an effect tool applied at most once:
 * labels (set semantics), comments (found again by their hidden marker
 * after a lost effect record) and closing an issue (meant to be gated by
 * a `beforeToolExecution` hook that calls approve() for it).
 */
export function createWriteTools(app: IGithubApp): ToolSet {
    return {
        github_add_labels: defineEffectTool<LabelsInput, GithubIssueLabels>({
            description: 'Add labels to an issue or pull request (existing labels stay). Use names from github_list_labels.',
            inputSchema: numberSchema<LabelsInput>('issue', {
                labels: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    minItems: 1,
                    maxItems: LABELS_MAX,
                    description: 'The label names to add.',
                },
            }),
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const issueNumber = requireInteger(input.number, 'number', 1);
                const labels = requireLabels(input.labels);
                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
                        owner,
                        repo,
                        issue_number: issueNumber,
                        labels,
                    });
                    return { labels: data.map((label) => label.name) };
                });
            },
        }),

        github_create_comment: defineEffectTool<CommentInput, GithubComment>({
            description: 'Comment on an issue or pull request. One comment per issue per step: put everything for one issue into one call; a second call for the same issue in the same step returns the first comment and posts nothing.',
            inputSchema: numberSchema<CommentInput>('issue', {
                body: {
                    type: 'string', 
                    minLength: 1, 
                    description: 'The comment in GitHub Markdown.', 
                }, 
            }),
            effectKey: commentKey,
            alreadyApplied: async (key, input, ctx) => {
                const { owner, repo } = parseRepo(input.repo);
                const issueNumber = requireInteger(input.number, 'number', 1);
                const marker = effectMarker(key);
                const since = reconcileSince(ctx);
                return withOctokit(app, ctx, { owner, repo }, async (octokit) => {
                    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
                        owner,
                        repo,
                        issue_number: issueNumber,
                        since,
                        per_page: 100,
                    });
                    for await (const { data } of pages) {
                        for (const comment of data) {
                            if (!comment.body?.includes(marker)) continue;
                            const user = isObject(comment.user) ? comment.user : undefined;
                            if (user?.type !== 'Bot' || !isSameLogin(user.login, await app.botLogin())) continue;
                            return { id: Number(comment.id), url: comment.html_url };
                        }
                    }
                    return undefined;
                });
            },
            execute: async (input, options) => {
                const body = requireString(input.body, 'body');
                const { owner, repo } = parseRepo(input.repo);
                const key = commentKey(input, options.context, options);
                return withOctokit(app, options.context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
                        owner,
                        repo,
                        issue_number: input.number,
                        body: `${body}\n\n${effectMarker(key)}`,
                    });
                    return { id: Number(data.id), url: data.html_url };
                });
            },
        }),

        github_close_issue: defineEffectTool<CloseInput, GithubClosedIssue>({
            description: 'Close an issue, as completed or not planned.',
            inputSchema: numberSchema<CloseInput>('issue', {
                reason: {
                    type: 'string',
                    enum: CLOSE_REASONS,
                    description: 'Why the issue is closed (default: completed).',
                },
            }, ['reason']),
            alreadyApplied: async (_key, input, ctx) => {
                const { owner, repo } = parseRepo(input.repo);
                const issueNumber = requireInteger(input.number, 'number', 1);
                return withOctokit(app, ctx, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
                        owner,
                        repo,
                        issue_number: issueNumber,
                    });
                    if (data.state !== 'closed') return undefined;
                    return {
                        number: data.number,
                        state: 'closed' as const,
                        stateReason: data.state_reason ?? null,
                    };
                });
            },
            execute: async (input, { context }) => {
                const { owner, repo } = parseRepo(input.repo);
                const issueNumber = requireInteger(input.number, 'number', 1);
                const reason = requireReason(input.reason);
                return withOctokit(app, context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
                        owner,
                        repo,
                        issue_number: issueNumber,
                        state: 'closed',
                        ...(reason !== undefined ? { state_reason: reason } : {}),
                    });
                    return {
                        number: data.number,
                        state: 'closed' as const,
                        stateReason: data.state_reason ?? null,
                    };
                });
            },
        }),

        github_create_issue: defineEffectTool<IssueInput, GithubCreatedIssue>({
            description: 'Open an issue, e.g. a report or a question for the maintainers. Applied at most once per run for the same input.',
            inputSchema: objectSchema<IssueInput>({
                repo: REPO_PROPERTY,
                title: {
                    type: 'string',
                    minLength: 1,
                    maxLength: ISSUE_TITLE_MAX_CHARS,
                    description: 'The issue title.',
                },
                body: {
                    type: 'string',
                    minLength: 1,
                    description: 'The issue in GitHub Markdown.',
                },
                labels: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    maxItems: LABELS_MAX,
                    description: 'Labels to set (existing label names).',
                },
            }, ['labels']),
            effectKey: issueKey,
            alreadyApplied: async (key, input, ctx) => {
                const { owner, repo } = parseRepo(input.repo);
                const marker = effectMarker(key);
                return withOctokit(app, ctx, { owner, repo }, async (octokit) => {
                    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/issues', {
                        owner,
                        repo,
                        state: 'all',
                        creator: await app.botLogin(),
                        since: reconcileSince(ctx),
                        per_page: 100,
                    });
                    for await (const { data } of pages) {
                        for (const issue of data) {
                            if (issue.body?.includes(marker)) return { number: issue.number, url: issue.html_url };
                        }
                    }
                    return undefined;
                });
            },
            execute: async (input, options) => {
                const { owner, repo } = parseRepo(input.repo);
                const title = requireString(input.title, 'title');
                const body = requireString(input.body, 'body');
                // an empty list is no labels, as the input schema allows it
                const labels = input.labels === undefined || (Array.isArray(input.labels) && input.labels.length === 0) ?
                    undefined :
                    requireLabels(input.labels);
                const marker = effectMarker(issueKey(input, options.context));
                return withOctokit(app, options.context, { owner, repo }, async (octokit) => {
                    const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
                        owner,
                        repo,
                        title,
                        body: `${body}\n\n${marker}`,
                        ...(labels ? { labels } : {}),
                    });
                    return { number: data.number, url: data.html_url };
                });
            },
        }),
    };
}
