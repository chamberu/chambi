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

/** A parsed repository (`parseRepo`), the target an installation is resolved for. */
export type RepoTarget = { owner: string; repo: string };

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
    headSha: string;
    /** `owner/name` of the head repository; null when the fork was deleted. */
    headRepo: string | null;
    /** The head lives in another repository than the base (or was deleted). */
    fork: boolean;
    /** The author's account type, e.g. `Bot` or `User`. */
    authorType: string | null;
    labels: string[];
    /** null while GitHub is still computing it. */
    mergeable: boolean | null;
    /** GitHub's `mergeable_state` (`clean`, `unstable`, `dirty`, `blocked`, `behind`, `draft`, `has_hooks`, `unknown`). */
    mergeableState: string;
    maintainerCanModify: boolean;
    mergeCommitSha: string | null;
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

/** One repository of `github_list_repositories`: `repo` is `owner/name`, `account` the installation's account. */
export type GithubRepository = {
    repo: string;
    installationId: number;
    account: string;
    private: boolean;
    archived: boolean;
    fork: boolean;
    defaultBranch: string;
    url: string;
};

/** `github_list_repositories`, sorted by `repo`; `truncated` when REPOSITORIES_MAX cut it. */
export type GithubRepositoryList = {
    repositories: GithubRepository[];
    truncated: boolean;
};

/** One open issue of `github_list_issues`. */
export type GithubIssueSummary = {
    number: number;
    title: string;
    author: string | null;
    labels: string[];
    comments: number;
    createdAt: string;
    updatedAt: string;
    url: string;
};

/** `github_list_issues`, newest updated first; `truncated` when more remained. */
export type GithubIssueList = {
    issues: GithubIssueSummary[];
    truncated: boolean;
};

/** One open pull request of `github_list_pull_requests`. */
export type GithubPullRequestSummary = {
    number: number;
    title: string;
    author: string | null;
    authorType: string | null;
    draft: boolean;
    base: string;
    head: string;
    headSha: string;
    headRepo: string | null;
    fork: boolean;
    labels: string[];
    createdAt: string;
    updatedAt: string;
    url: string;
};

/** `github_list_pull_requests`; `truncated` when more remained. */
export type GithubPullRequestList = {
    pullRequests: GithubPullRequestSummary[];
    truncated: boolean;
};

/** `github_get_push_target`: whether the App can push fix commits onto a pull request's branch. */
export type GithubPushTarget = {
    number: number;
    headRepo: string | null;
    headBranch: string;
    headSha: string;
    fork: boolean;
    /** The App's installation on the head repository, null when not installed. */
    installationId: number | null;
    contents: 'read' | 'write' | null;
    workflows: 'read' | 'write' | null;
    maintainerCanModify: boolean;
    /** headRepo set, installed, contents write. A fork the App is not installed on is never pushable (App tokens cannot use maintainer edits). */
    canPush: boolean;
    /** Why `canPush` is false, else null. */
    reason: string | null;
};
