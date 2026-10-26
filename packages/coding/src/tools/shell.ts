/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

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
    OUTPUT_LOGS_BUDGET_CAPS,
    REPORT_FAILED_EXIT_CODE,
    REPORT_SCRIPT,
    REPORT_TIMEOUT_MS,
} from './constants.ts';
import {
    inputObject,
    objectSchema,
    optionalBoolean,
    optionalInteger,
    redactText,
    requirePath,
    requireString,
    signalOf,
    workspaceOf,
} from './helpers.ts';
import { startJob } from './jobs.ts';
import { excerptOf, parseReport } from './output.ts';
import type { BashJobResult, BashResult, CodingWorkspaces } from './types.ts';

type BashInput = {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    background?: boolean;
    workspace?: string;
};

/** The error for a call that left no report even when read again: its folders or the report could not be written. */
function reportError(result: ExecResult): SandboxError {
    const stderr = result.stderr.trim().slice(0, 500);
    let message = `bash left no report: exit code ${result.exitCode}${stderr ? `: ${stderr}` : ''}`;
    if (result.exitCode === REPORT_FAILED_EXIT_CODE) {
        message += '. $HOME/.chamvi has no space left or is not writable: free space (e.g. in /tmp or ~/.chamvi/out), then call again.';
    }
    return new SandboxError(message);
}

/** Runs one foreground command and reads its report (again, after a timeout killed the script). */
async function runCommand(
    workspace: IWorkspace,
    input: {
        command: string; 
        cwd?: string; 
        timeoutMs: number; 
        signal: AbortSignal;
        outputLogMaxBytes: number;
    },
): Promise<BashResult> {
    const id = randomBytes(6).toString('hex');
    const cap = String(input.outputLogMaxBytes);
    const budget = String(input.outputLogMaxBytes * OUTPUT_LOGS_BUDGET_CAPS);
    const result = await workspace.exec(
        ['sh', '-c', BASH_SCRIPT, 'sh', INNER_SCRIPT, input.command, id, input.cwd ?? '', cap, budget],
        { timeoutMs: input.timeoutMs, signal: input.signal },
    );
    if (input.cwd !== undefined && result.stdout === `${CWD_MISSING}\n`) {
        throw new SandboxError(`cwd ${absoluteWorkspacePath(input.cwd)} is no directory in the workspace.`);
    }

    let report = parseReport(result.stdout, result.stderr);
    if (!report) {
        // the script was killed with the command (its timeout or log cap), or could not write its report: read what the command wrote
        const again = await workspace.exec(['sh', '-c', REPORT_SCRIPT, 'sh', id, cap, budget], {
            timeoutMs: REPORT_TIMEOUT_MS,
            signal: input.signal,
        });
        report = parseReport(again.stdout, again.stderr);
        if (!report) throw reportError(again);
    }

    const stdout = excerptOf(report.stdout);
    const stderr = excerptOf(report.stderr);
    return {
        exitCode: report.status ?? result.exitCode,
        // decoded from base64 here, so the workspace's exec redaction never saw them
        stdout: redactText(workspace, stdout.text),
        stderr: redactText(workspace, stderr.text),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        stdoutBytes: report.stdout.size,
        stderrBytes: report.stderr.size,
        stdoutLog: report.stdout.log,
        stderrLog: report.stderr.log,
        cwd: report.cwd,
        outputCapped: report.capped,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
    };
}

export function bashTool(workspaces: CodingWorkspaces, outputLogMaxBytes: number): Tool<BashInput, BashResult | BashJobResult> {
    return defineTool<BashInput, BashResult | BashJobResult>({
        description: 'Run a shell command in the workspace (bash when the image has it, else sh), e.g. to install dependencies, build or run tests. ' +
            'The shell keeps its working directory and exported variables from one call to the next (not functions, aliases or options); ' +
            'cwd is where the next call starts. ' +
            `Output past ${EXCERPT_HEAD_BYTES + EXCERPT_TAIL_BYTES} bytes per stream shows its start and end; the whole of it is in stdoutLog and stderrLog ` +
            '(read them with read_file, grep or bash). A command past its timeout is killed (timedOut: true), and so is one whose log ' +
            `passes ${outputLogMaxBytes} bytes (outputCapped: true; redirect huge output to a file). No interactive input. ` +
            'A process the command leaves running (cmd &) keeps writing to the log and is killed once the log passes that size. ' +
            'For servers and watchers pass background: true and read the output with bash_output. ' +
            'A command that sets its own EXIT trap replaces the one that keeps the working directory and exported variables, so that call\'s are not kept. ' +
            'When git fetch, pull or push fails to authenticate here, use git_fetch, git_pull and git_push, which carry the run\'s credentials.',
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
                return startJob(workspace, {
                    command,
                    cwd,
                    signal,
                    outputLogMaxBytes,
                });
            }
            return runCommand(workspace, {
                command,
                cwd,
                timeoutMs,
                signal,
                outputLogMaxBytes,
            });
        },
    });
}
