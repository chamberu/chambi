/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { GitCredential } from '../credentials/types.ts';
import { EXEC_TIMEOUT_MS } from '../workspace/constants.ts';
import type { ExecResult, IWorkspace } from '../workspace/types.ts';
import { GIT_AUTH_SCRIPT } from './constants.ts';
import { urlOrigin, urlRepoPath } from './helpers.ts';

/**
 * The argv (and stdin) of `git <args>` against `url`: without a credential
 * every configured credential helper reset and hooks off; with one through
 * `GIT_AUTH_SCRIPT`, which takes the credential from stdin and answers only
 * for `url`'s origin and path.
 */
export function gitArgv(url: string, args: readonly string[], credential?: GitCredential): { argv: string[]; stdin?: string } {
    if (!credential) {
        return { argv: ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', ...args] };
    }
    return {
        argv: ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', urlOrigin(url), urlRepoPath(url), ...args],
        stdin: `${credential.username}\n${credential.password}\n`,
    };
}

/** Runs `git <args>` against `url` in the workspace (`gitArgv`), default timeout `EXEC_TIMEOUT_MS`. */
export function runGit(workspace: IWorkspace, input: {
    url: string;
    args: readonly string[];
    credential?: GitCredential;
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<ExecResult> {
    const { argv, stdin } = gitArgv(input.url, input.args, input.credential);
    const options: Parameters<IWorkspace['exec']>[1] = {};
    if (stdin !== undefined) options.stdin = stdin;
    if (input.cwd !== undefined) options.cwd = input.cwd;
    options.timeoutMs = input.timeoutMs ?? EXEC_TIMEOUT_MS;
    if (input.signal) options.signal = input.signal;
    return workspace.exec(argv, options);
}
