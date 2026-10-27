/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { ValidationError, defineEffectTool, effectMarker } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import type { IGithubApp } from '../app/types.ts';
import { HEAD_PATTERN, ISSUE_TITLE_MAX_CHARS, REF_PATTERN } from './constants.ts';
import {
    REPO_PROPERTY,
    inputEffectKey,
    objectSchema,
    parseRepo,
    requireRef,
    requireString,
    withOctokit,
} from './helpers.ts';
import type { GithubCreatedPullRequest, RepoInput } from './types.ts';

type CreatePullRequestInput = RepoInput & {
    head: string;
    base?: string;
    title: string;
    body: string;
    draft?: boolean;
};

const HEAD = new RegExp(HEAD_PATTERN);

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

function toCreated(data: {
    number: number; 
    html_url: string; 
    base: { ref: string }; 
    head: { ref: string; label?: string | null } 
}): GithubCreatedPullRequest {
    return {
        number: data.number,
        url: data.html_url,
        base: data.base.ref,
        head: data.head.label ?? data.head.ref,
    };
}

/** `github_create_pull_request`. */
export function createPullRequestWriteTools(app: IGithubApp): ToolSet {
    return {
        github_create_pull_request: defineEffectTool<CreatePullRequestInput, GithubCreatedPullRequest>({
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
                            if (pull.body?.includes(marker)) return toCreated(pull);
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
                if (input.draft !== undefined && typeof input.draft !== 'boolean') throw new ValidationError('draft must be a boolean.');
                const marker = effectMarker(pullRequestKey(input, options.context));
                return withOctokit(app, options.context, { owner, repo }, async (octokit) => {
                    const base = given ?? (await octokit.request('GET /repos/{owner}/{repo}', { owner, repo })).data.default_branch;
                    const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
                        owner,
                        repo,
                        // as given: GitHub takes a branch of the base repository unqualified
                        head: input.head,
                        base,
                        title,
                        body: `${body}\n\n${marker}`,
                        draft: input.draft === true,
                    });
                    return toCreated(data);
                });
            },
        }),
    };
}
