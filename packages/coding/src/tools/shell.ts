/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import type { Tool } from 'ai';
import { SandboxError, defineTool } from '@chamvi/core';
import { EXEC_TIMEOUT_MAX_MS, EXEC_TIMEOUT_MS, absoluteWorkspacePath } from '@chamvi/sandbox';
import type { ExecResult, IWorkspace } from '@chamvi/sandbox';
import {
    BASH_SCRIPT,
    CWD_MISSING,
    EXCERPT_HEAD_BYTES,
    EXCERPT_TAIL_BYTES,
    INNER_SCRIPT,
    REPORT_SCRIPT,
    REPORT_TIMEOUT_MS,
} from './constants.ts';
import {
    inputObject,
    objectSchema,
    optionalBoolean,
    optionalInteger,
    requirePath,
    requireString,
    signalOf,
    workspaceOf,
} from './helpers.ts';
import { excerptOf, parseReport } from './output.ts';
import type { BashResult, CodingWorkspaces } from './types.ts';

type BashInput = {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    background?: boolean;
    workspace?: string;
};

/** A result from the exec alone, when no report could be read (the script could not even start). */
function plainResult(result: ExecResult): BashResult {
    return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        stdoutBytes: Buffer.byteLength(result.stdout),
        stderrBytes: Buffer.byteLength(result.stderr),
        stdoutLog: '',
        stderrLog: '',
        cwd: '',
        timedOut: result.timedOut,
        durationMs: result.durationMs,
    };
}

/** Runs one foreground command and reads its report (again, after a timeout killed the script). */
async function runCommand(
    workspace: IWorkspace,
    input: {
        command: string; 
        cwd?: string; 
        timeoutMs: number; 
        signal: AbortSignal 
    },
): Promise<BashResult> {
    const id = randomBytes(6).toString('hex');
    const result = await workspace.exec(
        ['sh', '-c', BASH_SCRIPT, 'sh', INNER_SCRIPT, input.command, id, input.cwd ?? ''],
        { timeoutMs: input.timeoutMs, signal: input.signal },
    );
    if (input.cwd !== undefined && result.stdout === `${CWD_MISSING}\n`) {
        throw new SandboxError(`cwd ${absoluteWorkspacePath(input.cwd)} is no directory in the workspace.`);
    }

    let report = parseReport(result.stdout, result.stderr);
    if (!report) {
        // the script was killed with the command (its timeout): read what the command wrote
        const again = await workspace.exec(['sh', '-c', REPORT_SCRIPT, 'sh', id], {
            timeoutMs: REPORT_TIMEOUT_MS,
            signal: input.signal,
        });
        report = parseReport(again.stdout, again.stderr);
    }
    if (!report) return plainResult(result);

    const stdout = excerptOf(report.stdout);
    const stderr = excerptOf(report.stderr);
    return {
        exitCode: report.status ?? result.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        stdoutBytes: report.stdout.size,
        stderrBytes: report.stderr.size,
        stdoutLog: report.stdout.log,
        stderrLog: report.stderr.log,
        cwd: report.cwd,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
    };
}

export function bashTool(workspaces: CodingWorkspaces): Tool<BashInput, BashResult> {
    return defineTool<BashInput, BashResult>({
        description: 'Run a shell command in the workspace (bash when the image has it, else sh), e.g. to install dependencies, build or run tests. ' +
            'The shell keeps its working directory and exported variables from one call to the next (not functions, aliases or options); ' +
            'cwd is where the next call starts. ' +
            `Output past ${EXCERPT_HEAD_BYTES + EXCERPT_TAIL_BYTES} bytes per stream shows its start and end; the whole of it is in stdoutLog and stderrLog ` +
            '(read them with read_file, grep or bash). A command past its timeout is killed (timedOut: true). No interactive input. ' +
            'For servers and watchers pass background: true and read the output with bash_output.',
        inputSchema: objectSchema<BashInput>({
            command: {
                type: 'string',
                minLength: 1,
                description: 'The command line.',
            },
            cwd: {
                type: 'string',
                minLength: 1,
                description: 'Run this call in this directory (relative to the workspace root) instead of the kept one; the kept one does not change.',
            },
            timeoutMs: {
                type: 'integer',
                minimum: 1,
                maximum: EXEC_TIMEOUT_MAX_MS,
                description: `Kill the command after this many milliseconds. Default ${EXEC_TIMEOUT_MS}. Not for background jobs.`,
            },
            background: {
                type: 'boolean',
                description: 'Start the command as a background job and return its id at once (dev servers, watchers). Default false.',
            },
        }, ['command']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const command = requireString(body.command, 'command');
            const cwd = body.cwd === undefined ? undefined : requirePath(body.cwd, 'cwd');
            const timeoutMs = optionalInteger(body.timeoutMs, 'timeoutMs', 1, EXEC_TIMEOUT_MAX_MS) ?? EXEC_TIMEOUT_MS;
            const background = optionalBoolean(body.background, 'background') ?? false;
            const workspace = await workspaceOf(workspaces, body, context);
            const signal = signalOf(abortSignal, context);

            if (background) {
                throw new SandboxError('background jobs are not supported yet.');
            }
            return runCommand(workspace, {
                command,
                cwd,
                timeoutMs,
                signal,
            });
        },
    });
}
