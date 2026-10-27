/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Most results `github_search_issues` returns. */
export const SEARCH_MAX_RESULTS = 20;

/** Results `github_search_issues` returns without a `limit`. */
export const SEARCH_DEFAULT_RESULTS = 10;

/** `github_get_file` cuts a file's text after this many characters. */
export const FILE_MAX_CHARS = 65_536;

/** Most labels one `github_add_labels` call adds. */
export const LABELS_MAX = 20;

/**
 * `owner/name`, as the tools take a repository: GitHub's name characters
 * (`[A-Za-z0-9_.-]`), each segment with at least one that is not a dot, so
 * `.` and `..` (which URL resolution folds into another API path) never pass.
 */
export const REPO_PATTERN = '^([\\w.-]*[\\w-][\\w.-]*)/([\\w.-]*[\\w-][\\w.-]*)$';

/** The code of a failed GitHub request handed to the model as a tool error. */
export const GITHUB_REQUEST_ERROR_CODE = 'github_request';

/** Releases `github_list_releases` returns at most. */
export const RELEASES_MAX = 20;

/** `github_list_releases` cuts each release body after this many characters. */
export const RELEASE_BODY_MAX_CHARS = 8_000;

/** Pages of 100 releases `github_list_releases` reads at most. */
export const RELEASE_PAGES_MAX = 10;

/** Commits `github_compare` returns at most. */
export const COMPARE_COMMITS_MAX = 100;

/** Changed files `github_compare` returns at most (GitHub's own limit is 300). */
export const COMPARE_FILES_MAX = 300;

/** `github_compare` keeps a commit message's first line, cut at this many characters. */
export const COMMIT_MESSAGE_MAX_CHARS = 300;

/** A branch, tag or commit `github_compare` takes (`owner:branch` for a fork). */
export const REF_PATTERN = '^[\\w./:@+-]{1,255}$';

/** Repositories `github_list_repositories` returns at most (over every installation). */
export const REPOSITORIES_MAX = 1000;

/** Issues `github_list_issues` returns at most (and without a `limit`). */
export const ISSUES_MAX = 100;

/** Open pull requests `github_list_pull_requests` returns at most (and without a `limit`). */
export const PULL_REQUESTS_MAX = 100;

/** Check runs `github_get_pull_request_checks` reads at most (then `truncated`). */
export const CHECKS_MAX = 300;

/** A pull request head `github_create_pull_request` takes: `branch`, or `owner:branch` for a fork. */
export const HEAD_PATTERN = '^(?:[\\w.-]+:)?[\\w./+-]{1,255}$';

/** The merge methods GitHub offers. */
export const MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;

/** The merge method of `github_merge_pull_request` unless `writeTools({ mergeMethod })` or the call names one. */
export const DEFAULT_MERGE_METHOD = 'squash';

/** GitHub's limit on an issue or pull request title. */
export const ISSUE_TITLE_MAX_CHARS = 256;

/** The `mergeable_state`s `github_merge_pull_request` merges in (`unstable`: a check that is not required failed). */
export const MERGE_STATES = ['clean', 'unstable', 'has_hooks'] as const;

/** A head sha `github_merge_pull_request` takes (loose: GitHub's 409 answers a wrong one). */
export const SHA_PATTERN = '^[\\w-]{1,64}$';

/** GitHub's limit on a commit title, also for a merge. */
export const COMMIT_TITLE_MAX_CHARS = 256;
