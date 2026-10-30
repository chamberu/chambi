/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { GithubOctokit } from '../app/types.ts';
import type { GithubCreatedPullRequest, RepoTarget } from './types.ts';

export function toCreated(data: {
    number: number;
    html_url: string;
    base: { ref: string };
    head: { ref: string; label?: string | null };
}): GithubCreatedPullRequest {
    return {
        number: data.number,
        url: data.html_url,
        base: data.base.ref,
        head: data.head.label ?? data.head.ref,
    };
}

/** Shared PR creation for explicit PRs and allowlisted file proposals. Never merges. */
export async function createPullRequest(
    octokit: GithubOctokit,
    target: RepoTarget,
    input: {
        head: string;
        base?: string;
        title: string;
        body: string;
        draft?: boolean
    },
): Promise<GithubCreatedPullRequest> {
    let { base } = input;

    if (!base) {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}', target);

        base = data.default_branch;
    }

    const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        ...target,
        ...input,
        base,
        draft: input.draft ?? false,
    });

    return toCreated(data);
}
