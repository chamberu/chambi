/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import {
    LINE_MAX_CHARS,
    LIST_DEFAULT_RESULTS,
    LIST_MAX_RESULTS,
    SEARCH_DEFAULT_RESULTS,
    SEARCH_MAX_RESULTS,
} from './constants.ts';
import {
    cutText,
    gitFailure,
    gitMessage,
    inputObject,
    objectSchema,
    optionalBoolean,
    optionalInteger,
    optionalPath,
    requireString,
    signalOf,
    workspaceOf,
} from './helpers.ts';
import type {
    CodingWorkspaces,
    GrepMatch,
    GrepResult,
    ListFilesResult,
} from './types.ts';

type GrepInput = {
    pattern: string;
    path?: string;
    ignoreCase?: boolean;
    limit?: number;
    workspace?: string;
};
type ListFilesInput = {
    path?: string; 
    limit?: number; 
    workspace?: string 
};

const PATH = {
    type: 'string',
    minLength: 1,
    description: 'A file or directory relative to the workspace root (or starting with /workspace/). Default: the whole workspace.',
} as const;

/**
 * The complete records of `git grep -z -n` output (`path\0line\0text\n`); a
 * record cut by the output cap is dropped.
 */
function parseGrep(stdout: string): GrepMatch[] {
    const matches: GrepMatch[] = [];
    let position = 0;
    while (position < stdout.length) {
        const pathEnd = stdout.indexOf('\0', position);
        if (pathEnd === -1) break;
        const lineEnd = stdout.indexOf('\0', pathEnd + 1);
        if (lineEnd === -1) break;
        const textEnd = stdout.indexOf('\n', lineEnd + 1);
        if (textEnd === -1) break;
        matches.push({
            path: stdout.slice(position, pathEnd),
            line: Number(stdout.slice(pathEnd + 1, lineEnd)),
            text: cutText(stdout.slice(lineEnd + 1, textEnd), LINE_MAX_CHARS),
        });
        position = textEnd + 1;
    }
    return matches;
}

export function grepTool(workspaces: CodingWorkspaces): Tool<GrepInput, GrepResult> {
    return defineTool<GrepInput, GrepResult>({
        description: 'Search the text files of the workspace (tracked and untracked, not git-ignored) for an extended regular expression (git grep -E). ' +
            `Returns path, 1-based line and the line text (cut at ${LINE_MAX_CHARS} characters).`,
        inputSchema: objectSchema<GrepInput>({
            pattern: {
                type: 'string',
                minLength: 1,
                description: 'A POSIX extended regular expression.',
            },
            path: PATH,
            ignoreCase: { type: 'boolean', description: 'Match case-insensitively. Default false.' },
            limit: {
                type: 'integer',
                minimum: 1,
                maximum: SEARCH_MAX_RESULTS,
                description: `Matches to return at most. Default ${SEARCH_DEFAULT_RESULTS}.`,
            },
        }, ['pattern']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const pattern = requireString(body.pattern, 'pattern');
            const path = optionalPath(body.path);
            const ignoreCase = optionalBoolean(body.ignoreCase, 'ignoreCase') ?? false;
            const limit = optionalInteger(body.limit, 'limit', 1, SEARCH_MAX_RESULTS) ?? SEARCH_DEFAULT_RESULTS;
            const workspace = await workspaceOf(workspaces, body, context);

            // --literal-pathspecs: a path such as ':!src' names a file, it is no pathspec magic
            const argv = ['git', '--literal-pathspecs', 'grep', '-z', '-n', '-I', '--untracked', '--no-color', '-E'];
            if (ignoreCase) argv.push('-i');
            argv.push('-e', pattern, '--', path);
            const result = await workspace.exec(argv, { signal: signalOf(abortSignal, context) });

            if (result.exitCode === 1 && !result.timedOut) {
                return { matches: [], truncated: false };
            }
            if (result.exitCode === 128 && !result.timedOut) {
                throw new ValidationError(`grep failed: ${gitMessage(result)}`);
            }
            if (result.exitCode !== 0) {
                throw gitFailure('grep', result);
            }

            const matches = parseGrep(result.stdout);
            return {
                matches: matches.slice(0, limit),
                truncated: matches.length > limit || result.stdoutTruncated,
            };
        },
    });
}

export function listFilesTool(workspaces: CodingWorkspaces): Tool<ListFilesInput, ListFilesResult> {
    return defineTool<ListFilesInput, ListFilesResult>({
        description: 'List the files of the workspace (tracked and untracked, not git-ignored), sorted, below an optional path.',
        inputSchema: objectSchema<ListFilesInput>({
            path: PATH,
            limit: {
                type: 'integer',
                minimum: 1,
                maximum: LIST_MAX_RESULTS,
                description: `Files to return at most. Default ${LIST_DEFAULT_RESULTS}.`,
            },
        }),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const path = optionalPath(body.path);
            const limit = optionalInteger(body.limit, 'limit', 1, LIST_MAX_RESULTS) ?? LIST_DEFAULT_RESULTS;
            const workspace = await workspaceOf(workspaces, body, context);

            const result = await workspace.exec(
                ['git', '--literal-pathspecs', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', path],
                { signal: signalOf(abortSignal, context) },
            );
            if (result.exitCode !== 0) {
                throw gitFailure('list_files', result);
            }

            const entries = result.stdout.split('\0');
            // the entry after the last NUL is empty, or cut by the output cap
            entries.pop();
            const files = [...new Set(entries)].sort();
            return {
                files: files.slice(0, limit),
                truncated: files.length > limit || result.stdoutTruncated,
            };
        },
    });
}
