/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The input of a tool on a repository. */
export type RepoInput = { repo: string };

/** The input of a tool on an issue or pull request. */
export type NumberInput = RepoInput & { number: number };

/** `github_get_issue`. */
export type GithubIssue = {
    number: number;
    title: string;
    body: string | null;
    state: string;
    labels: string[];
    author: string | null;
    url: string;
    createdAt: string;
    comments: number;
    isPullRequest: boolean;
};

/** `github_search_issues`. */
export type GithubIssueSearch = {
    total: number;
    items: Array<{
        repo: string;
        number: number;
        title: string;
        state: string;
        url: string;
    }>;
};

/** One entry of `github_list_labels`. */
export type GithubLabel = {
    name: string;
    description: string | null;
};

/** `github_get_pull_request`; `base` and `head` are branch names. */
export type GithubPullRequest = {
    number: number;
    title: string;
    body: string | null;
    state: string;
    draft: boolean;
    merged: boolean;
    base: string;
    head: string;
    author: string | null;
    url: string;
    changedFiles: number;
};

/** `github_get_file` for a file: UTF-8 text, cut at FILE_MAX_CHARS characters. */
export type GithubFile = {
    path: string;
    size: number;
    content: string;
    truncated: boolean;
};

/** `github_get_file` for a directory. */
export type GithubDirectory = {
    path: string;
    entries: Array<{
        name: string;
        type: string;
        path: string;
    }>;
};

/** `github_get_latest_release`; `{ none: true }` when the repository has no release. */
export type GithubRelease = {
    tag: string;
    name: string | null;
    publishedAt: string | null;
    url: string;
    body: string | null;
} | { none: true };

/** One release of `github_list_releases`. */
export type GithubReleaseNote = {
    tag: string;
    name: string | null;
    publishedAt: string | null;
    url: string;
    prerelease: boolean;
    /** Cut at RELEASE_BODY_MAX_CHARS characters. */
    body: string | null;
    bodyTruncated: boolean;
};

/** `github_list_releases`: oldest first; `truncated` when more matched than RELEASES_MAX or the pages read did not reach `from`. */
export type GithubReleaseList = {
    releases: GithubReleaseNote[];
    truncated: boolean;
};

/** `github_compare`: commits oldest first, both lists capped. */
export type GithubComparison = {
    status: string;
    aheadBy: number;
    behindBy: number;
    totalCommits: number;
    url: string;
    commits: Array<{
        sha: string;
        /** The first line, cut at 300 characters. */
        message: string;
        author: string | null;
        date: string | null;
    }>;
    files: Array<{
        path: string;
        status: string;
        additions: number;
        deletions: number;
    }>;
    /** True when commits were cut or the files reached GitHub's cap of 300 (more may exist). */
    truncated: boolean;
};

/** `github_create_comment`: the posted (or found) comment. */
export type GithubComment = {
    id: number;
    url: string;
};

/** `github_add_labels`: every label the issue carries afterwards. */
export type GithubIssueLabels = {
    labels: string[];
};

/** `github_close_issue`. */
export type GithubClosedIssue = {
    number: number;
    state: 'closed';
    stateReason: string | null;
};
