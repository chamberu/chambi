/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { decodeRepoPath, trimRepoPath } from '../credentials/helpers.ts';
import type { GitCredential } from '../credentials/types.ts';

/** `https://host[:port]` of a URL. */
export function urlOrigin(url: string): string {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
}

/** The repository path of a URL as git's credential helpers see it: decoded, without `/` ends and `.git`. ValidationError for a malformed escape. */
export function urlRepoPath(url: string): string {
    return trimRepoPath(decodeRepoPath(new URL(url).pathname));
}

/** The credentials file key of a repository URL (`<origin>/<path>`), or of a host (`<origin>/`). */
export function credentialKey(url: string): string {
    return `${urlOrigin(url)}/${urlRepoPath(url)}`;
}

/** The credentials file: one `<key>\t<username>\t<password>` line per entry. */
export function credentialsFileContent(entries: ReadonlyArray<{ key: string } & Pick<GitCredential, 'username' | 'password'>>): string {
    return entries.map((entry) => `${entry.key}\t${entry.username}\t${entry.password}\n`).join('');
}
