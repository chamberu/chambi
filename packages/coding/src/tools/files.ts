/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import type { Tool } from 'ai';
import { SandboxError, ValidationError, defineTool } from '@chamvi/core';
import { READ_LOG_SCRIPT, READ_MAX_CHARS, READ_MAX_LINES } from './constants.ts';
import {
    cutText,
    homeLogPath,
    inputObject,
    objectSchema,
    optionalBoolean,
    optionalInteger,
    requirePath,
    requireString,
    requireText,
    signalOf,
    workspaceOf,
} from './helpers.ts';
import type { createKeyedQueue } from './helpers.ts';
import type { IWorkspace } from '@chamvi/sandbox';
import type {
    CodingWorkspaces,
    EditFileResult,
    ReadFileResult,
    WriteFileResult,
} from './types.ts';

/** Serializes the writes of one file: keyed by workspace id and path. */
type FileQueue = ReturnType<typeof createKeyedQueue>;

/** The queue key of a file: workspace ids are UUIDs, so no two workspaces share one. */
const fileKey = (workspaceId: string, path: string) => `${workspaceId}:${path}`;

type ReadFileInput = {
    path: string; 
    offset?: number; 
    limit?: number; 
    workspace?: string 
};
type WriteFileInput = {
    path: string; 
    content: string; 
    workspace?: string 
};
type EditFileInput = {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
    workspace?: string;
};

const PATH = {
    type: 'string',
    minLength: 1,
    description: 'A file path relative to the workspace root, or starting with /workspace/.',
} as const;

/** The lines of `text`; a trailing newline ends the last line, it opens none. */
function linesOf(text: string): string[] {
    if (text.length === 0) return [];
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines;
}

/** The lines from `offset` (`slice`, already cut to the line limit) as a result, cut at READ_MAX_CHARS. */
function sliceResult(path: string, slice: string[], offset: number, totalLines: number, cut: boolean): ReadFileResult {
    let content = slice.join('\n');
    let endLine = offset - 1 + slice.length;
    let truncated = cut;
    if (content.length > READ_MAX_CHARS) {
        content = cutText(content, READ_MAX_CHARS);
        truncated = true;
        const newlines = content.split('\n').length - 1;
        endLine = offset + newlines - (content.endsWith('\n') ? 1 : 0);
    }
    return {
        path,
        content,
        startLine: offset,
        endLine,
        totalLines,
        truncated,
    };
}

/** Lines of an output log under `$HOME` (`below`), read with awk in the workspace. */
async function readLog(
    workspace: IWorkspace,
    input: {
        path: string; 
        below: string; 
        offset: number; 
        limit: number; 
        signal: AbortSignal 
    },
): Promise<ReadFileResult> {
    const { offset, limit } = input;
    const result = await workspace.exec(
        ['sh', '-c', READ_LOG_SCRIPT, 'sh', input.below, String(offset), String(offset + limit - 1)],
        { signal: input.signal },
    );
    if (result.exitCode === 3) {
        throw new SandboxError(`file not found: ${input.path}`);
    }
    const totalLines = Number(result.stderr.trim().split('\n').at(-1));
    if (result.exitCode !== 0 || !Number.isSafeInteger(totalLines)) {
        throw new SandboxError(`cannot read ${input.path}: exit code ${result.exitCode}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
    }
    if (offset > Math.max(totalLines, 1)) {
        throw new ValidationError(`offset ${offset} is past the end of ${input.path}, which has ${totalLines} lines.`);
    }
    const lines = linesOf(result.stdout);
    // the exec's output cap may have cut the last line
    if (result.stdoutTruncated && lines.length > 1) lines.pop();
    return sliceResult(input.path, lines, offset, totalLines, result.stdoutTruncated);
}

export function readFileTool(workspaces: CodingWorkspaces): Tool<ReadFileInput, ReadFileResult> {
    return defineTool<ReadFileInput, ReadFileResult>({
        description: `Read a text file of the workspace, by line range. Returns at most ${READ_MAX_LINES} lines and ${READ_MAX_CHARS} characters ` +
            '(truncated: true when cut); compare endLine with totalLines to see whether more follows. ' +
            'Also reads the output logs bash and bash_output name (~/.chamvi/out/..., ~/.chamvi/jobs/.../output).',
        inputSchema: objectSchema<ReadFileInput>({
            path: PATH,
            offset: {
                type: 'integer',
                minimum: 1,
                description: 'The first line to read, 1-based. Default 1.',
            },
            limit: {
                type: 'integer',
                minimum: 1,
                maximum: READ_MAX_LINES,
                description: `How many lines to read. Default ${READ_MAX_LINES}.`,
            },
        }, ['path']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const below = homeLogPath(body.path);
            const path = below === undefined ? requirePath(body.path) : body.path as string;
            const offset = optionalInteger(body.offset, 'offset', 1, Number.MAX_SAFE_INTEGER) ?? 1;
            const limit = optionalInteger(body.limit, 'limit', 1, READ_MAX_LINES) ?? READ_MAX_LINES;
            const workspace = await workspaceOf(workspaces, body, context);
            if (below !== undefined) {
                return readLog(workspace, {
                    path,
                    below,
                    offset,
                    limit,
                    signal: signalOf(abortSignal, context),
                });
            }

            const lines = linesOf(await workspace.readFile(path));
            const totalLines = lines.length;
            if (offset > Math.max(totalLines, 1)) {
                throw new ValidationError(`offset ${offset} is past the end of ${path}, which has ${totalLines} lines.`);
            }
            return sliceResult(path, lines.slice(offset - 1, offset - 1 + limit), offset, totalLines, false);
        },
    });
}

export function writeFileTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<WriteFileInput, WriteFileResult> {
    return defineTool<WriteFileInput, WriteFileResult>({
        description: 'Write a UTF-8 text file in the workspace, replacing it when it exists and creating missing directories. ' +
            'Prefer edit_file for changing part of an existing file.',
        inputSchema: objectSchema<WriteFileInput>({
            path: PATH,
            content: { type: 'string', description: 'The whole file content.' },
        }, ['path', 'content']),
        execute: async (input, { context }) => {
            const body = inputObject(input);
            const path = requirePath(body.path);
            const content = requireText(body.content, 'content');
            const workspace = await workspaceOf(workspaces, body, context);

            await queue(fileKey(workspace.id, path), () => workspace.writeFile(path, content));
            return { path, bytes: Buffer.byteLength(content, 'utf8') };
        },
    });
}

export function editFileTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<EditFileInput, EditFileResult> {
    return defineTool<EditFileInput, EditFileResult>({
        description: 'Replace an exact string in a file of the workspace. oldString must match the file exactly (whitespace included) and only once, ' +
            'unless replaceAll is true; add surrounding lines to make it unique.',
        inputSchema: objectSchema<EditFileInput>({
            path: PATH,
            oldString: {
                type: 'string',
                minLength: 1,
                description: 'The exact text to replace.',
            },
            newString: { type: 'string', description: 'The text to put in its place.' },
            replaceAll: { type: 'boolean', description: 'Replace every match instead of exactly one. Default false.' },
        }, ['path', 'oldString', 'newString']),
        execute: async (input, { context }) => {
            const body = inputObject(input);
            const path = requirePath(body.path);
            const oldString = requireString(body.oldString, 'oldString');
            const newString = requireText(body.newString, 'newString');
            const replaceAll = optionalBoolean(body.replaceAll, 'replaceAll') ?? false;
            if (oldString === newString) {
                throw new ValidationError('oldString and newString are the same: nothing to change.');
            }
            const workspace = await workspaceOf(workspaces, body, context);

            // read, change and write in one turn of the file's queue
            return queue(fileKey(workspace.id, path), async () => {
                const text = await workspace.readFile(path);
                const parts = text.split(oldString);
                const count = parts.length - 1;
                if (count === 0) {
                    throw new ValidationError(`oldString not found in ${path}. Read the file and copy the text exactly.`);
                }
                if (count > 1 && !replaceAll) {
                    throw new ValidationError(`oldString has ${count} matches in ${path}: add surrounding text to make it unique, or pass replaceAll: true.`);
                }

                // split/join: replace() would expand `$&` and friends in newString
                const updated = replaceAll ?
                    parts.join(newString) :
                    `${parts[0]}${newString}${parts.slice(1).join(oldString)}`;
                await workspace.writeFile(path, updated);
                return { path, replacements: replaceAll ? count : 1 };
            });
        },
    });
}
