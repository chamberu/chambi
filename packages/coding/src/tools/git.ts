/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { defineTool } from '@chamvi/core';
import {
    gitFailure,
    inputObject,
    objectSchema,
    optionalBoolean,
    optionalPath,
    signalOf,
    untrustedWorkspaceResult,
    workspaceOf,
} from './helpers.ts';
import type { CodingWorkspaces, GitDiffResult } from './types.ts';

type GitDiffInput = {
    staged?: boolean;
    path?: string;
    workspace?: string
};

export function gitDiffTool(workspaces: CodingWorkspaces): Tool<GitDiffInput, GitDiffResult> {
    return defineTool<GitDiffInput, GitDiffResult>({
        trust: { taint: (input, ctx) => untrustedWorkspaceResult(workspaces, input, ctx) },
        description: 'Show the changes in the workspace: git status --short (untracked files as ??) and the unified diff of the working tree ' +
            'against the index, or of the index against HEAD with staged: true.',
        inputSchema: objectSchema<GitDiffInput>({
            staged: { type: 'boolean', description: 'Diff the staged changes (git diff --staged). Default false.' },
            path: {
                type: 'string',
                minLength: 1,
                description: 'Limit to a file or directory relative to the workspace root. Default: the whole workspace.',
            },
        }),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const staged = optionalBoolean(body.staged, 'staged') ?? false;
            const path = optionalPath(body.path);
            const workspace = await workspaceOf(workspaces, body, context);
            const signal = signalOf(abortSignal, context);

            const status = await workspace.exec(['git', '--literal-pathspecs', 'status', '--short', '--', path], { signal });

            if (status.exitCode !== 0) {
                throw gitFailure('git status', status);
            }

            const argv = ['git', '--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff'];

            if (staged) {
                argv.push('--staged');
            }

            argv.push('--', path);

            const diff = await workspace.exec(argv, { signal });

            if (diff.exitCode !== 0) {
                throw gitFailure('git diff', diff);
            }

            return {
                status: status.stdout,
                diff: diff.stdout,
                truncated: status.stdoutTruncated || diff.stdoutTruncated,
            };
        },
    });
}
