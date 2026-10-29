/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IWorkspaceManager, RepositoryInstructions } from '@chamvi/sandbox';

/** What the coding tools need of a workspace manager: the run's workspaces by id. */
export type CodingWorkspaces = Pick<IWorkspaceManager, 'get'>;

export type CodingToolsOptions = {
    /** Attach current path-scoped repository guidance to text reads. Default true. */
    repositoryInstructions?: boolean;
    /**
     * Bytes one output log of `bash` may grow to (per stream). A call whose
     * log passes it is killed (`outputCapped: true`) and the log cut back to
     * it. Default `OUTPUT_LOG_MAX_BYTES` (64 MiB).
     */
    outputLogMaxBytes?: number;
};

export type ReadFileResult = {
    /** Relative to `/workspace`. */
    path: string;
    content: string;
    /** 1-based, inclusive. */
    startLine: number;
    endLine: number;
    totalLines: number;
    /** Current repository guidance for this path; absent for logs or when disabled. */
    instructions?: RepositoryInstructions;
    /** True when `content` was cut at `READ_MAX_CHARS`. */
    truncated: boolean;
};

/** `read_file` with `encoding: 'base64'`. */
export type ReadFileBinaryResult = {
    path: string;
    encoding: 'base64';
    /** The file's bytes, base64. */
    content: string;
    bytes: number;
};

/** `read_file` of a png, jpeg, gif or webp image: the model gets it as an image part. */
export type ReadFileImageResult = {
    path: string;
    type: 'image';
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    bytes: number;
    /**
     * The run artifact holding the image (`context.artifacts`): the model
     * gets the bytes through its marker, so the tool step and the
     * checkpoints keep this id, never the image.
     */
    artifactId: string;
};

export type WriteFileResult = {
    path: string;
    bytes: number;
};

export type EditFileResult = {
    path: string;
    replacements: number;
};

export type MultiEditResult = {
    path: string;
    /** How many edits were applied (all of them). */
    edits: number;
    /** Replacements of all edits together. */
    replacements: number;
};

export type GrepMatch = {
    path: string;
    line: number;
    text: string;
};

/** The program `grep` searched with: its regular expression syntax differs. */
export type GrepEngine = 'ripgrep' | 'git-grep' | 'grep';

export type GrepResult = {
    matches: GrepMatch[];
    /** True when more matches exist than were returned. */
    truncated: boolean;
    engine: GrepEngine;
};

export type ListFilesResult = {
    files: string[];
    truncated: boolean;
};

export type BashResult = {
    /** The command's exit status (124 or 137 after a timeout). */
    exitCode: number;
    /**
     * Stdout, whole when it has at most `EXCERPT_HEAD_BYTES` +
     * `EXCERPT_TAIL_BYTES` bytes, else its start and end around a
     * `[... <n> bytes cut, full output in <stdoutLog>]` line.
     */
    stdout: string;
    stderr: string;
    /** True when the middle of stdout was cut (the whole of it is in `stdoutLog`). */
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    /** Bytes the command wrote to stdout. */
    stdoutBytes: number;
    stderrBytes: number;
    /** `~/.chamvi/out/<id>.stdout.log`: the whole stdout, readable with read_file, grep or bash. */
    stdoutLog: string;
    stderrLog: string;
    /** The working directory the next call starts in (`/workspace/...` inside the workspace). */
    cwd: string;
    /**
     * True when a log passed `outputLogMaxBytes`: the call was killed with
     * its jobs, like a timeout, and the log keeps the first bytes up to the cap.
     */
    outputCapped: boolean;
    timedOut: boolean;
    durationMs: number;
};

/** What `bash` returns for `background: true`. */
export type BashJobResult = {
    /** The job id for bash_output and bash_kill. */
    job: string;
    status: 'running';
    /** `~/.chamvi/jobs/<id>/output`: stdout and stderr of the job. */
    outputLog: string;
};

/**
 * `running`; `exited` (with `exitCode`); `killed` by bash_kill; `lost` when
 * it ended without an exit status (its container restarted).
 */
export type BashJobStatus = 'running' | 'exited' | 'killed' | 'lost';

export type BashOutputResult = {
    job: string;
    status: BashJobStatus;
    exitCode?: number;
    /** Output from `offset` on, at most `JOB_OUTPUT_MAX_BYTES` bytes. */
    output: string;
    offset: number;
    /** Pass it as `offset` to read on. */
    nextOffset: number;
    /** Bytes of output so far. */
    size: number;
    /** True when more output follows `nextOffset`. */
    truncated: boolean;
    /**
     * True when the output passed `outputLogMaxBytes`: the job was killed
     * with every process it started (status `killed`) and its output cut
     * back to the cap.
     */
    outputCapped: boolean;
};

export type BashKillResult = {
    job: string;
    status: BashJobStatus;
    exitCode?: number;
};

export type GlobResult = {
    /** Relative to the workspace root, sorted. */
    files: string[];
    truncated: boolean;
};

export type GitDiffResult = {
    /** `git status --short`. */
    status: string;
    diff: string;
    truncated: boolean;
};
