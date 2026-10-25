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

/** The git config key `prepareWorkspace` records the checked out commit under. */
export const CHECKOUT_COMMIT_KEY = 'chamvi.commit';

/** Exec timeout of `readCheckoutCommit`. */
export const COMMIT_READ_TIMEOUT_MS = 30_000;
