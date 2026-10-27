/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** GitHub's REST API; GitHub Enterprise Server uses `https://<host>/api/v3`. */
export const DEFAULT_GITHUB_API_URL = 'https://api.github.com';

/** How long `IGithubApp.installationFor()` keeps a repository's installation (10 minutes, on the clock). */
export const INSTALLATION_CACHE_TTL_MS = 600_000;
