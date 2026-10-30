/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { CREDENTIAL_REFRESH_MS, CREDENTIAL_RETRY_MS } from '../credentials/constants.ts';
import { createRedactor, credentialRequest, resolveGitCredential } from '../credentials/helpers.ts';
import type {
    GitCredential,
    IGitCredentials,
} from '../credentials/types.ts';
import { CREDENTIAL_HELPER_SCRIPT, INSTALL_CREDENTIALS_SCRIPT } from '../git/constants.ts';
import { credentialKey, credentialsFileContent, urlOrigin } from '../git/helpers.ts';
import type { ExecResult, IWorkspace } from '../workspace/types.ts';
import { CREDENTIAL_INSTALL_TIMEOUT_MS } from './constants.ts';

import type { CredentialSupport } from './types.ts';

type InstallState = {
    installed?: boolean;
    /**
     * The workspace holds no credentials file content: created by this
     * process, or emptied by an install. Undefined while unknown (a workspace
     * found again, which may hold an earlier process's file).
     */
    empty?: boolean;
    /** When the file must be rewritten (epoch ms); undefined: never (no credential expires). */
    refreshAt?: number;
    /** No new attempt before this (epoch ms) after a failure. */
    retryAt?: number;
    pending?: Promise<void>;
};

function isHttps(url: string): boolean {
    return url.startsWith('https://');
}

export function createCredentialSupport(input: {
    sources: readonly IGitCredentials[];
    clock: IClock;
    onError: (error: unknown) => void;
}): CredentialSupport {
    const {
        sources,
        clock,
        onError,
    } = input;
    const redactor = createRedactor({ clock });
    const states = new WeakMap<IWorkspace, InstallState>();
    const wrapped = new WeakMap<IWorkspace, IWorkspace>();

    const lookup: CredentialSupport['lookup'] = async (url, access, runId, signal) => {
        if (!isHttps(url)) {
            return undefined;
        }

        const credential = await resolveGitCredential(sources, credentialRequest(url, access, runId, signal));

        if (credential) {
            redactor.add(credential.password, credential.expiresAt);
        }

        return credential;
    };

    /** Writes the file; answers when it must be rewritten. */
    const install = async (workspace: IWorkspace, state: InstallState): Promise<number | undefined> => {
        const url = workspace.info.repo!;
        const { runId } = workspace.info;
        const entries: Array<GitCredential & { key: string }> = [];
        let repo: GitCredential | undefined;
        let writeError: unknown;

        try {
            repo = await lookup(url, 'write', runId);
        } catch (error) {
            // e.g. an App without contents: write: the read credential still serves fetch and pull
            writeError = error;
        }

        if (!repo) {
            // a failing read lookup fails the install (reported once by refresh)
            repo = await lookup(url, 'read', runId);

            if (writeError !== undefined) {
                onError(redactor.redactError(writeError));
            }
        }

        if (repo) {
            entries.push({ key: credentialKey(url), ...repo });
        }

        // a token for the whole host (private dependencies of the same host)
        const host = await lookup(`${urlOrigin(url)}/`, 'read', runId);

        if (host) {
            entries.push({ key: `${urlOrigin(url)}/`, ...host });
        }

        // nothing to write into a workspace known to hold nothing: keep its own git config
        // (a helper of the image) untouched; stale credentials are always cleared
        if (entries.length === 0 && state.empty === true) {
            return undefined;
        }

        const content = credentialsFileContent(entries);
        const result = await workspace.exec(
            ['sh', '-c', INSTALL_CREDENTIALS_SCRIPT, 'sh', CREDENTIAL_HELPER_SCRIPT, String(Buffer.byteLength(content))],
            { stdin: content, timeoutMs: CREDENTIAL_INSTALL_TIMEOUT_MS },
        );

        if (result.exitCode !== 0 || result.timedOut) {
            const reason = result.timedOut ? 'timed out' : `exited with ${result.exitCode}`;
            throw new SandboxError(`writing the git credentials of workspace ${workspace.id} ${reason}: ${redactor.redact(result.stderr.trim()).slice(0, 500)}`);
        }

        const expiries = entries.flatMap((entry) => (entry.expiresAt ? [entry.expiresAt.getTime()] : []));

        if (expiries.length === 0) {
            return undefined;
        }

        // a source may keep answering a token inside the window (IGithubApp until 5 minutes
        // before its expiry): try again a minute later instead of before every exec
        return Math.max(Math.min(...expiries) - CREDENTIAL_REFRESH_MS, clock.now().getTime() + CREDENTIAL_RETRY_MS);
    };

    const stateOf = (workspace: IWorkspace): InstallState | undefined => {
        const { repo } = workspace.info;

        if (repo === undefined || !isHttps(repo)) {
            return undefined;
        }

        let state = states.get(workspace);

        if (!state) {
            state = {};
            states.set(workspace, state);
        }

        return state;
    };

    const refresh: CredentialSupport['refresh'] = async (workspace, options = {}) => {
        const state = stateOf(workspace);

        if (!state) {
            return;
        }

        if (options.fresh) {
            state.empty = true;
        }

        const now = clock.now().getTime();

        if (state.installed && (state.refreshAt === undefined || now < state.refreshAt)) {
            return;
        }

        if (state.retryAt !== undefined && now < state.retryAt) {
            return;
        }

        if (!state.pending) {
            const current = state;
            const write = install(workspace, current);

            current.pending = write.then((refreshAt) => {
                current.installed = true;
                current.empty = undefined;
                current.refreshAt = refreshAt;
                delete current.retryAt;
            }, (error: unknown) => {
                current.retryAt = clock.now().getTime() + CREDENTIAL_RETRY_MS;
                onError(redactor.redactError(error));
            }).finally(() => {
                delete current.pending;
            });
        }

        await state.pending;
    };

    const redactResult = (result: ExecResult): ExecResult => {
        const stdout = redactor.redact(result.stdout);
        const stderr = redactor.redact(result.stderr);

        return stdout === result.stdout && stderr === result.stderr ? result : {
            ...result,
            stdout,
            stderr,
        };
    };

    const guard = async <T>(run: () => Promise<T>): Promise<T> => {
        try {
            return await run();
        } catch (error) {
            throw redactor.redactError(error);
        }
    };

    const wrap: CredentialSupport['wrap'] = (workspace) => {
        const known = wrapped.get(workspace);

        if (known) {
            return known;
        }

        const proxy: IWorkspace = {
            get id() {
                return workspace.id;
            },
            get info() {
                return workspace.info;
            },
            get disposed() {
                return workspace.disposed;
            },
            exec: (argv, options) => guard(async () => {
                await refresh(workspace);

                return redactResult(await workspace.exec(argv, options));
            }),
            readFile: (path) => guard(async () => redactor.redact(await workspace.readFile(path))),
            // for tools that write the text back; its errors are redacted like every other call's
            readFileRaw: (path) => guard(() => workspace.readFile(path)),
            readBytes: (path) => guard(async () => redactor.redactBytes(await workspace.readBytes(path))),
            writeFile: (path, content) => guard(() => workspace.writeFile(path, content)),
            dispose: () => guard(() => workspace.dispose()),
            redact: (text) => redactor.redact(text),
            redactedSpans: (text) => redactor.redactedSpans(text),
        };

        wrapped.set(workspace, proxy);

        return proxy;
    };

    return {
        redactor,
        lookup,
        refresh,
        wrap,
    };
}
