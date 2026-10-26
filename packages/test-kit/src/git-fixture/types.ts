/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type GitFixture = {
    /** The repository directory. */
    path: string;
    /** `file://` URL of `path`, as `normalizeRepo` returns it. */
    url: string;
    /** The one commit (branch `main`, tag `v1`). */
    commit: string;
    /**
     * Runs `git <args>` in `path` with the fixture's identity, dates and
     * isolated config (signing off), answering stdout: more commits,
     * branches and tags.
     */
    git(...args: string[]): Promise<string>;
    cleanup(): Promise<void>;
};
