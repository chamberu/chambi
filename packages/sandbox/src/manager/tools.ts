/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { defineTool } from '@chamvi/core';
import {
    inputObject,
    optionalObjectSchema,
    optionalString,
    toToolResult,
} from './helpers.ts';
import type {
    DisposeWorkspaceResult,
    IWorkspaceManager,
    WorkspaceToolResult,
} from './types.ts';

/**
 * `create_workspace` and `dispose_workspace` over `manager`, scoped to the
 * calling run (`context.run.runId`). Plain chamvi tools, not effect tools:
 * a workspace dies with its process, so a recorded result would outlive it.
 */
export function createWorkspaceTools(manager: IWorkspaceManager): ToolSet {
    return {
        create_workspace: defineTool<{
            repo?: string; 
            ref?: string; 
            image?: string 
        }, WorkspaceToolResult>({
            description: 'Create a disposable workspace for this run, mounted at /workspace: a shallow checkout of a git repository at a ref, or an empty git repository without one. ' +
                'Calling it again with the same repository returns the same workspace (reused: true). Pass the returned workspace id to the other tools when the run holds several.',
            inputSchema: optionalObjectSchema({
                repo: {
                    type: 'string',
                    minLength: 1,
                    description: 'The repository: "owner/name" (GitHub) or an https clone URL. Omit it for an empty workspace.',
                },
                ref: {
                    type: 'string',
                    minLength: 1,
                    description: 'A branch, tag or commit to check out (needs repo). Default: the default branch.',
                },
                image: {
                    type: 'string',
                    minLength: 1,
                    description: 'The container image, e.g. "python:3.13" or "rust:1". It needs sh, git and GNU coreutils. ' +
                        'Default: the operator\'s image, which installs toolchains with mise (e.g. mise use -g node@22).',
                },
            }),
            execute: async (input, { context }) => {
                const body = inputObject(input);
                const repo = optionalString(body.repo, 'repo');
                const ref = optionalString(body.ref, 'ref');
                const image = optionalString(body.image, 'image');
                const { workspace, reused } = await manager.acquire(context.run.runId, {
                    repo,
                    ref,
                    image,
                    signal: context.run.signal,
                });
                return toToolResult(workspace, reused);
            },
        }),

        dispose_workspace: defineTool<{ workspace?: string }, DisposeWorkspaceResult>({
            description: 'Dispose a workspace of this run and everything in it. Omit workspace when the run holds only one.',
            inputSchema: optionalObjectSchema({
                workspace: {
                    type: 'string',
                    minLength: 1,
                    description: 'The workspace id from create_workspace.',
                },
            }),
            execute: async (input, { context }) => {
                const body = inputObject(input);
                const id = optionalString(body.workspace, 'workspace');
                const { runId } = context.run;
                const workspace = await manager.get(runId, id);
                await manager.release(runId, workspace.id);
                return { workspace: workspace.id, disposed: true };
            },
        }),
    };
}
