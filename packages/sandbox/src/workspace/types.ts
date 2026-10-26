/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** What a provider knows about a workspace; `commit` is set after the checkout. */
export type WorkspaceInfo = {
    runId: string;
    /** `ISandboxProvider.name` of the provider that created it. */
    provider: string;
    /** The normalized repository URL. */
    repo?: string;
    ref?: string;
    /** HEAD after the checkout. */
    commit?: string;
    /** The image of a container or pod workspace. */
    image?: string;
    createdAt: Date;
    expiresAt: Date;
};

export type ExecOptions = {
    /** Relative to the workspace root or under `/workspace/`; default the root. */
    cwd?: string;
    /** Default `EXEC_TIMEOUT_MS`, at most `EXEC_TIMEOUT_MAX_MS`. */
    timeoutMs?: number;
    stdin?: string;
    signal?: AbortSignal;
};

export type ExecResult = {
    exitCode: number;
    /** At most `OUTPUT_MAX_BYTES` bytes of UTF-8. */
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
    durationMs: number;
};

/**
 * A disposable directory a run executes commands in. Exec takes argv only,
 * never a shell string.
 */
export interface IWorkspace {
    readonly id: string;
    readonly info: WorkspaceInfo;
    /**
     * True after `dispose()`, or once the workspace found its container, pod
     * or directory gone (stopped, killed or removed outside chamvi). Every
     * call then rejects with SandboxError; the manager drops such a workspace
     * and disposes it, which removes what is left of it.
     */
    readonly disposed: boolean;
    exec(argv: readonly string[], options?: ExecOptions): Promise<ExecResult>;
    /** UTF-8 text of at most `FILE_MAX_BYTES`; SandboxError for a file that is not UTF-8. */
    readFile(path: string): Promise<string>;
    /** The raw bytes of a file of at most `FILE_MAX_BYTES`. */
    readBytes(path: string): Promise<Uint8Array>;
    /** A string is written as UTF-8, bytes as they are; at most `FILE_MAX_BYTES`. */
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    /** Idempotent. Every call after it rejects with SandboxError. */
    dispose(): Promise<void>;
}
