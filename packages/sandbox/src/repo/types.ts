/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { GitCredential } from '../credentials/types.ts';

export type NormalizeRepoOptions = {
    /** Accept `file:///absolute/path` (local development and tests). Default false. */
    allowFileRepos?: boolean;
    /** Narrows the accepted repositories further; gets the normalized URL. */
    allowRepo?: (url: string) => boolean;
};

/** How `prepareWorkspace` checks out a repository (`WorkspaceCreateOptions.checkout`). */
export type CheckoutOptions = {
    /** A shallow fetch of this many commits; default the full history. */
    depth?: number;
    /**
     * Read access to an https repository: written over stdin only into the
     * workspace credential helper's file (`INSTALL_CREDENTIALS_SCRIPT`)
     * before the remote calls, so it stays there for later git calls.
     */
    credential?: GitCredential;
};
