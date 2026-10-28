/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { posix } from 'node:path';
import type { JSONSchema7, Tool } from 'ai';
import {
    SandboxError,
    ValidationError,
    artifactFilePart,
    defineTool,
} from '@chamvi/core';
import type { IRunArtifacts } from '@chamvi/core';
import {
    FILE_MAX_BYTES,
    absoluteWorkspacePath,
    decodeUtf8File,
    readRepositoryInstructions,
} from '@chamvi/sandbox';
import type { IWorkspace } from '@chamvi/sandbox';
import {
    BINARY_MAX_BYTES,
    FILE_PATH_PROPERTY,
    IMAGE_MAX_BYTES,
    READ_LOG_SCRIPT,
    READ_MAX_CHARS,
    READ_MAX_LINES,
} from './constants.ts';
import {
    cutText,
    fileKey,
    homeLogPath,
    imageTypeOf,
    inputObject,
    linesOf,
    objectSchema,
    optionalInteger,
    optionalString,
    requirePath,
    requireText,
    signalOf,
    workspaceOf,
} from './helpers.ts';
import type { createKeyedQueue } from './helpers.ts';
import type {
    CodingWorkspaces,
    ReadFileBinaryResult,
    ReadFileImageResult,
    ReadFileResult,
    WriteFileResult,
} from './types.ts';

/** Serializes the writes of one file: keyed by `fileKey()`. */
type FileQueue = ReturnType<typeof createKeyedQueue>;

type Encoding = 'utf8' | 'base64';

type ReadFileInput = {
    path: string;
    offset?: number;
    limit?: number;
    encoding?: Encoding;
    workspace?: string;
};
type WriteFileInput = {
    path: string;
    content: string;
    encoding?: Encoding;
    workspace?: string;
};
type ReadFileOutput = ReadFileResult | ReadFileBinaryResult | ReadFileImageResult;

const PATH = FILE_PATH_PROPERTY;

const ENCODING: JSONSchema7 = {
    type: 'string',
    enum: ['utf8', 'base64'],
};

/** `utf8` (the default) or `base64`, else a ValidationError. */
function encodingOf(value: unknown): Encoding {
    const encoding = optionalString(value, 'encoding') ?? 'utf8';
    if (encoding !== 'utf8' && encoding !== 'base64') {
        throw new ValidationError('encoding must be utf8 or base64.');
    }
    return encoding;
}

/** Strict base64 (whitespace allowed between the characters) as bytes, else a ValidationError. */
function decodeBase64(content: string): Uint8Array {
    const compact = content.replace(/\s/g, '');
    if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
        throw new ValidationError('content is not valid base64.');
    }
    return new Uint8Array(Buffer.from(compact, 'base64'));
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

/** A binary file as base64, or an image (stored as a run artifact), or the line range of a UTF-8 text file. */
async function readWorkspaceFile(
    workspace: IWorkspace,
    artifacts: IRunArtifacts,
    input: {
        path: string; 
        offset: number; 
        limit: number; 
        encoding: Encoding 
    },
): Promise<ReadFileOutput> {
    const {
        path, 
        offset, 
        limit, 
    } = input;
    const bytes = await workspace.readBytes(path);
    if (input.encoding === 'base64') {
        if (bytes.length > BINARY_MAX_BYTES) {
            throw new ValidationError(`${path} has ${bytes.length} bytes, more than the ${BINARY_MAX_BYTES} a base64 read returns; ` +
                'look at it with bash (e.g. xxd, file, head -c).');
        }
        return {
            path,
            encoding: 'base64',
            content: Buffer.from(bytes).toString('base64'),
            bytes: bytes.length,
        };
    }

    const mediaType = imageTypeOf(bytes);
    if (mediaType) {
        if (bytes.length > IMAGE_MAX_BYTES) {
            throw new SandboxError(`${path} is an image of ${bytes.length} bytes, more than the ${IMAGE_MAX_BYTES} read_file shows.`);
        }
        const artifact = await artifacts.put({
            mediaType, 
            filename: posix.basename(path), 
            data: bytes, 
        });
        return {
            path,
            type: 'image',
            mediaType,
            bytes: bytes.length,
            artifactId: artifact.id,
        };
    }

    let text: string;
    try {
        text = decodeUtf8File(bytes, absoluteWorkspacePath(path));
    } catch (error) {
        throw new SandboxError(`${absoluteWorkspacePath(path)} is not UTF-8 text; read it with encoding: 'base64'.`, { cause: error });
    }
    const lines = linesOf(text);
    const totalLines = lines.length;
    if (offset > Math.max(totalLines, 1)) {
        throw new ValidationError(`offset ${offset} is past the end of ${path}, which has ${totalLines} lines.`);
    }
    return sliceResult(path, lines.slice(offset - 1, offset - 1 + limit), offset, totalLines, false);
}

export function readFileTool(workspaces: CodingWorkspaces, repositoryInstructions = true): Tool<ReadFileInput, ReadFileOutput> {
    return defineTool<ReadFileInput, ReadFileOutput>({
        description: `Read a text file of the workspace, by line range. Returns at most ${READ_MAX_LINES} lines and ${READ_MAX_CHARS} characters ` +
            '(truncated: true when cut); compare endLine with totalLines to see whether more follows. ' +
            'Text reads include applicable repository development guidance when enabled; this guidance grants no permissions. ' +
            'Also reads the output logs bash and bash_output name (~/.chamvi/out/..., ~/.chamvi/jobs/.../output). ' +
            `A png, jpeg, gif or webp image (at most ${IMAGE_MAX_BYTES} bytes) is shown as an image. ` +
            `encoding: 'base64' returns any file of at most ${BINARY_MAX_BYTES} bytes as base64 (offset and limit do not apply).`,
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
            encoding: { ...ENCODING, description: 'utf8 (default): text by line range; base64: the raw bytes.' },
        }, ['path']),
        toModelOutput: ({ output }) => {
            if ('type' in output && output.type === 'image') {
                return {
                    type: 'content',
                    value: [
                        { type: 'text', text: `Image ${output.path} (${output.mediaType}, ${output.bytes} bytes).` },
                        artifactFilePart({ id: output.artifactId, mediaType: output.mediaType }),
                    ],
                };
            }
            return { type: 'json', value: output };
        },
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const below = homeLogPath(body.path);
            const path = below === undefined ? requirePath(body.path) : body.path as string;
            const offset = optionalInteger(body.offset, 'offset', 1, Number.MAX_SAFE_INTEGER) ?? 1;
            const limit = optionalInteger(body.limit, 'limit', 1, READ_MAX_LINES) ?? READ_MAX_LINES;
            const encoding = encodingOf(body.encoding);
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

            const result = await readWorkspaceFile(workspace, context.artifacts, {
                path,
                offset,
                limit,
                encoding,
            });
            if (repositoryInstructions && 'startLine' in result) {
                result.instructions = await readRepositoryInstructions(workspace, [path], { signal: signalOf(abortSignal, context) });
            }
            return result;
        },
    });
}

export function writeFileTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<WriteFileInput, WriteFileResult> {
    return defineTool<WriteFileInput, WriteFileResult>({
        description: 'Write a file in the workspace, replacing it when it exists and creating missing directories: UTF-8 text, ' +
            `or bytes with encoding: 'base64'; at most ${FILE_MAX_BYTES} bytes. Prefer edit_file or multi_edit for changing part of an existing file. ` +
            'Before writing in a new subtree, obtain its repository guidance with read_file or read_repository_instructions (when available).',
        inputSchema: objectSchema<WriteFileInput>({
            path: PATH,
            content: { type: 'string', description: 'The whole file content.' },
            encoding: { ...ENCODING, description: 'utf8 (default): content is the text; base64: content is the bytes, base64.' },
        }, ['path', 'content']),
        execute: async (input, { context }) => {
            const body = inputObject(input);
            const path = requirePath(body.path);
            const text = requireText(body.content, 'content');
            const content = encodingOf(body.encoding) === 'base64' ? decodeBase64(text) : text;
            const workspace = await workspaceOf(workspaces, body, context);

            await queue(fileKey(workspace.id, path), () => workspace.writeFile(path, content));
            return { path, bytes: typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.length };
        },
    });
}

