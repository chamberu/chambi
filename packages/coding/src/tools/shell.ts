/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { defineTool } from '@chamvi/core';
import { EXEC_TIMEOUT_MAX_MS, EXEC_TIMEOUT_MS, OUTPUT_MAX_BYTES } from '@chamvi/sandbox';
import type { ExecResult } from '@chamvi/sandbox';
import {
    inputObject,
    objectSchema,
    optionalInteger,
    requirePath,
    requireString,
    signalOf,
    workspaceOf,
} from './helpers.ts';
import type { CodingWorkspaces } from './types.ts';

type BashInput = {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    workspace?: string;
};

export function bashTool(workspaces: CodingWorkspaces): Tool<BashInput, ExecResult> {
    return defineTool<BashInput, ExecResult>({
        description: 'Run a shell command (sh -c) in the workspace, e.g. to install dependencies, build or run tests. ' +
            `Returns the exit code and stdout and stderr, each cut at ${OUTPUT_MAX_BYTES} bytes (stdoutTruncated, stderrTruncated). ` +
            'A command past its timeout is killed (timedOut: true). No interactive input.',
        inputSchema: objectSchema<BashInput>({
            command: {
                type: 'string',
                minLength: 1,
                description: 'The command line, run by sh -c.',
            },
            cwd: {
                type: 'string',
                minLength: 1,
                description: 'The directory to run in, relative to the workspace root. Default: the root.',
            },
            timeoutMs: {
                type: 'integer',
                minimum: 1,
                maximum: EXEC_TIMEOUT_MAX_MS,
                description: `Kill the command after this many milliseconds. Default ${EXEC_TIMEOUT_MS}.`,
            },
        }, ['command']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const command = requireString(body.command, 'command');
            const cwd = body.cwd === undefined ? undefined : requirePath(body.cwd, 'cwd');
            const timeoutMs = optionalInteger(body.timeoutMs, 'timeoutMs', 1, EXEC_TIMEOUT_MAX_MS) ?? EXEC_TIMEOUT_MS;
            const workspace = await workspaceOf(workspaces, body, context);

            return workspace.exec(['sh', '-c', command], {
                cwd,
                timeoutMs,
                signal: signalOf(abortSignal, context),
            });
        },
    });
}
