/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import type { Tool } from 'ai';
import { SandboxError, ValidationError, defineTool } from '@chamvi/core';
import { absoluteWorkspacePath } from '@chamvi/sandbox';
import type { ExecResult, IWorkspace } from '@chamvi/sandbox';
import {
    CWD_MISSING,
    JOB_HEADER,
    JOB_ID_PATTERN,
    JOB_INNER_SCRIPT,
    JOB_KILL_SCRIPT,
    JOB_OUTPUT_MAX_BYTES,
    JOB_OUTPUT_SCRIPT,
    JOB_START_SCRIPT,
} from './constants.ts';
import {
    inputObject,
    objectSchema,
    optionalInteger,
    redactText,
    requireString,
    signalOf,
    untrustedWorkspaceResult,
    workspaceOf,
} from './helpers.ts';
import { completeLength } from './output.ts';
import type {
    BashJobResult,
    BashJobStatus,
    BashKillResult,
    BashOutputResult,
    CodingWorkspaces,
} from './types.ts';

type JobInput = { job: string; workspace?: string };
type JobOutputInput = JobInput & { offset?: number };

type JobState = {
    size: number;
    status: BashJobStatus;
    capped: boolean;
    exitCode?: number;
    /** The rest of stdout after the header line. */
    rest: string;
};

const JOB = {
    type: 'string',
    pattern: JOB_ID_PATTERN.source,
    description: 'The job id bash returned for background: true.',
} as const;

/** A job id, else a ValidationError. */
function requireJob(value: unknown): string {
    const job = requireString(value, 'job');

    if (!JOB_ID_PATTERN.test(job)) {
        throw new ValidationError('job must be a job id from bash (12 hex characters).');
    }

    return job;
}

/** The header line of a job script's answer; ValidationError for an unknown job. */
function readState(job: string, result: ExecResult): JobState {
    if (result.exitCode === 3) {
        throw new ValidationError(`There is no job ${job} in this workspace.`);
    }

    const newline = result.stdout.indexOf('\n');
    const header = new RegExp(`^${JOB_HEADER} (\\d+) (running|exited|killed|lost) ([01]) ?(\\d*)$`)
        .exec(newline === -1 ? '' : result.stdout.slice(0, newline));

    if (result.exitCode !== 0 || !header) {
        throw new SandboxError(`cannot read job ${job}: exit code ${result.exitCode}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
    }

    const state: JobState = {
        size: Number(header[1]),
        status: header[2] as BashJobStatus,
        capped: header[3] === '1',
        rest: result.stdout.slice(newline + 1),
    };

    if (header[4]) {
        state.exitCode = Number(header[4]);
    }

    return state;
}

/** Starts `command` as a background job of `workspace` (see JOB_START_SCRIPT). */
export async function startJob(
    workspace: IWorkspace,
    input: {
        command: string;
        cwd?: string;
        signal: AbortSignal;
        outputLogMaxBytes: number;
    },
): Promise<BashJobResult> {
    const job = randomBytes(6).toString('hex');
    const result = await workspace.exec(
        ['sh', '-c', JOB_START_SCRIPT, 'sh', JOB_INNER_SCRIPT, input.command, job, input.cwd ?? '', String(input.outputLogMaxBytes)],
        { signal: input.signal },
    );

    if (input.cwd !== undefined && result.stdout === `${CWD_MISSING}\n`) {
        throw new SandboxError(`cwd ${absoluteWorkspacePath(input.cwd)} is no directory in the workspace.`);
    }

    if (result.exitCode !== 0 || !result.stdout.startsWith(`${JOB_HEADER} `)) {
        throw new SandboxError(`cannot start the job: exit code ${result.exitCode}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
    }

    return {
        job,
        status: 'running',
        outputLog: `~/.chamvi/jobs/${job}/output`,
    };
}

export function bashOutputTool(workspaces: CodingWorkspaces, outputLogMaxBytes: number): Tool<JobOutputInput, BashOutputResult> {
    return defineTool<JobOutputInput, BashOutputResult>({
        trust: { untrustedResult: (input, ctx) => untrustedWorkspaceResult(workspaces, input, ctx) },
        description: 'Read the output (stdout and stderr together) and status of a background job of bash: ' +
            `at most ${JOB_OUTPUT_MAX_BYTES} bytes from offset (default 0); pass nextOffset to read on. ` +
            `A job whose output passes ${outputLogMaxBytes} bytes is killed with its processes (status killed, outputCapped: true). ` +
            'Status running, exited (with exitCode), killed or lost (its container restarted).',
        inputSchema: objectSchema<JobOutputInput>({
            job: JOB,
            offset: {
                type: 'integer',
                minimum: 0,
                description: 'The byte to read from. Default 0.',
            },
        }, ['job']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const job = requireJob(body.job);
            const offset = optionalInteger(body.offset, 'offset', 0, Number.MAX_SAFE_INTEGER) ?? 0;
            const workspace = await workspaceOf(workspaces, body, context);

            const result = await workspace.exec(
                ['sh', '-c', JOB_OUTPUT_SCRIPT, 'sh', job, String(offset), String(JOB_OUTPUT_MAX_BYTES)],
                { signal: signalOf(abortSignal, context) },
            );
            const state = readState(job, result);
            const bytes = new Uint8Array(Buffer.from(state.rest.replace(/\s/g, ''), 'base64'));

            // a character the byte limit split is read with the next offset
            const kept = bytes.length === JOB_OUTPUT_MAX_BYTES ? bytes.subarray(0, completeLength(bytes)) : bytes;
            const nextOffset = offset + kept.length;
            const answer: BashOutputResult = {
                job,
                status: state.status,
                // decoded here, so the workspace's exec redaction never saw it
                output: redactText(workspace, new TextDecoder().decode(kept)),
                offset,
                nextOffset,
                size: state.size,
                truncated: nextOffset < state.size,
                outputCapped: state.capped,
            };

            if (state.exitCode !== undefined) {
                answer.exitCode = state.exitCode;
            }

            return answer;
        },
    });
}

export function bashKillTool(workspaces: CodingWorkspaces): Tool<JobInput, BashKillResult> {
    return defineTool<JobInput, BashKillResult>({
        description: 'Stop a background job of bash and every process it started (TERM, then KILL after 3 seconds). ' +
            'A job that already exited is left as it is.',
        inputSchema: objectSchema<JobInput>({ job: JOB }, ['job']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const job = requireJob(body.job);
            const workspace = await workspaceOf(workspaces, body, context);

            const result = await workspace.exec(['sh', '-c', JOB_KILL_SCRIPT, 'sh', job], { signal: signalOf(abortSignal, context) });
            const state = readState(job, result);
            const answer: BashKillResult = { job, status: state.status };

            if (state.exitCode !== undefined) {
                answer.exitCode = state.exitCode;
            }

            return answer;
        },
    });
}
