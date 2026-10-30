/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError } from '@chamvi/core';
import type {
    ExecOptions,
    ExecResult,
    IWorkspace,
    WorkspaceInfo,
} from '@chamvi/sandbox';

export type ScriptedWorkspace = IWorkspace & {
    calls: Array<{ argv: string[]; options: ExecOptions }>;
    files: Map<string, string>;
    disposed: boolean;
};

/**
 * An in-memory workspace whose exec answers come from `handler`; every call
 * is recorded. Files live in a Map keyed by the given path.
 */
export function createScriptedWorkspace(
    handler: (argv: readonly string[], options: ExecOptions) => Partial<ExecResult> = () => ({}),
    info: Partial<WorkspaceInfo> = {},
    id = 'scripted',
): ScriptedWorkspace {
    const calls: Array<{ argv: string[]; options: ExecOptions }> = [];
    const files = new Map<string, string>();
    const workspace: ScriptedWorkspace = {
        id,
        info: {
            runId: 'run-1',
            provider: 'scripted',
            createdAt: new Date(0),
            expiresAt: new Date(1_800_000),
            ...info,
        },
        calls,
        files,
        disposed: false,
        async exec(argv, options = {}) {
            if (workspace.disposed) {
                throw new SandboxError('workspace disposed');
            }

            calls.push({ argv: [...argv], options });

            return {
                exitCode: 0,
                stdout: '',
                stderr: '',
                stdoutTruncated: false,
                stderrTruncated: false,
                timedOut: false,
                durationMs: 0,
                ...handler(argv, options),
            };
        },
        async readFile(path) {
            if (workspace.disposed) {
                throw new SandboxError('workspace disposed');
            }

            const content = files.get(path);

            if (content === undefined) {
                throw new SandboxError(`file not found: ${path}`);
            }

            return content;
        },
        async readBytes(path) {
            return new TextEncoder().encode(await workspace.readFile(path));
        },
        async writeFile(path, content) {
            if (workspace.disposed) {
                throw new SandboxError('workspace disposed');
            }

            files.set(path, typeof content === 'string' ? content : new TextDecoder().decode(content));
        },
        async dispose() {
            workspace.disposed = true;
        },
    };

    return workspace;
}
