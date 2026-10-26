/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** `owner/name` shorthand for a GitHub repository. */
export const GITHUB_SHORTHAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export const GITHUB_URL = 'https://github.com';

export const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+-]{0,254}$/;

export const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How much of git's stderr a checkout error carries. */
export const CHECKOUT_STDERR_MAX_LENGTH = 2_000;

export const REPO_RULE = 'repo must be "owner/name" or an https URL without credentials, query or fragment.';

/**
 * The git config key `prepareWorkspace` writes as its last step: the checked
 * out commit, or `NO_REPO_CHECKOUT` for a repo-less workspace. A workspace
 * without it is a create that died before its checkout finished.
 */
export const CHECKOUT_KEY = 'chamvi.checkout';

/** The `CHECKOUT_KEY` value of a finished repo-less workspace. */
export const NO_REPO_CHECKOUT = 'none';

/** The git config key `prepareWorkspace` records the remote's default branch under (before `CHECKOUT_KEY`). */
export const CHECKOUT_DEFAULT_BRANCH_KEY = 'chamvi.defaultBranch';

/** Exec timeout of `readCheckout`. */
export const CHECKOUT_READ_TIMEOUT_MS = 30_000;

/** Reads `readCheckout` makes before it gives up on a workspace it cannot read. */
export const CHECKOUT_READ_ATTEMPTS = 5;

/** Wait between two `readCheckout` reads (a container just restarted may refuse the first exec). */
export const CHECKOUT_READ_RETRY_MS = 500;
