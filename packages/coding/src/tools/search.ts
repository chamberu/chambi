/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { SandboxError, ValidationError, defineTool } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import type { ExecResult } from '@chamvi/sandbox';
import {
    GREP_SCRIPT,
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
    homeLogPath,
    inputObject,
    objectSchema,
    optionalBoolean,
    optionalInteger,
    optionalPath,
    requireString,
    signalOf,
    untrustedWorkspaceResult,
    workspaceOf,
} from './helpers.ts';
import type {
    CodingWorkspaces,
    GlobResult,
    GrepEngine,
    GrepMatch,
    GrepResult,
    ListFilesResult,
} from './types.ts';

type GrepInput = {
    pattern: string;
    path?: string;
    ignoreCase?: boolean;
    includeIgnored?: boolean;
    limit?: number;
    workspace?: string;
};
type ListFilesInput = {
    path?: string;
    includeIgnored?: boolean;
    limit?: number;
    workspace?: string;
};
type GlobInput = ListFilesInput & { pattern: string };

const PATH = {
    type: 'string',
    minLength: 1,
    description: 'A file or directory relative to the workspace root (or starting with /workspace/). Default: the whole workspace.',
} as const;

const INCLUDE_IGNORED = {
    type: 'boolean',
    description: 'Also git-ignored files (node_modules, vendor, build output). Default false.',
} as const;

const LIMIT = {
    type: 'integer',
    minimum: 1,
    maximum: LIST_MAX_RESULTS,
    description: `Files to return at most. Default ${LIST_DEFAULT_RESULTS}.`,
} as const;

const ENGINES: readonly GrepEngine[] = ['ripgrep', 'git-grep', 'grep'];

/** The notices ripgrep prints on stdout about a binary file, as `path: <notice>` lines. */
const BINARY_NOTICE = /: (?:WARNING: stopped searching binary file|binary file matches)/;

/**
 * The complete match records of the grep script's output: `path NUL line`
 * then `:` (ripgrep, grep) or NUL (git grep), then the text up to the
 * newline. A line that holds no record (a ripgrep binary notice) is
 * skipped and counted in `unparsed` unless it is such a notice; a record
 * cut by the output cap is dropped; `./` before a path is removed.
 */
export function parseMatches(output: string): { matches: GrepMatch[]; unparsed: number } {
    const matches: GrepMatch[] = [];
    let unparsed = 0;
    let position = 0;

    while (position < output.length) {
        const lineEnd = output.indexOf('\n', position);
        const pathEnd = output.indexOf('\0', position);
        const record = pathEnd === -1 || (lineEnd !== -1 && lineEnd < pathEnd) ?
            undefined :
            /^(\d+)[:\0]/.exec(output.slice(pathEnd + 1, pathEnd + 22));

        if (!record) {
            // a line without a record: skip it, a cut one at the end is dropped
            if (lineEnd === -1) {
                break;
            }

            if (!BINARY_NOTICE.test(output.slice(position, lineEnd))) {
                unparsed++;
            }

            position = lineEnd + 1;

            continue;
        }

        const textStart = pathEnd + 1 + record[0].length;
        const textEnd = output.indexOf('\n', textStart);

        if (textEnd === -1) {
            break;
        }

        const path = output.slice(position, pathEnd);

        matches.push({
            path: path.startsWith('./') ? path.slice(2) : path,
            line: Number(record[1]),
            text: cutText(output.slice(textStart, textEnd), LINE_MAX_CHARS),
        });
        position = textEnd + 1;
    }

    return { matches, unparsed };
}

/**
 * The grep script's result as matches; ValidationError for a pattern the
 * engine refused, SandboxError for output that holds lines but no record
 * (an engine or a tool that does not keep the NUL separators), never an
 * empty success.
 */
export function grepResult(result: ExecResult, limit: number, logPath: string | undefined): GrepResult {
    const newline = result.stdout.indexOf('\n');
    const engine = result.stdout.slice(0, Math.max(newline, 0)) as GrepEngine;

    if (!ENGINES.includes(engine) || result.timedOut) {
        throw gitFailure('grep', result);
    }

    const output = result.stdout.slice(newline + 1);
    const { matches: found, unparsed } = parseMatches(output);
    const matches = logPath === undefined ? found : found.map((match) => ({ ...match, path: logPath }));
    // grep and ripgrep exit 2 also for an unreadable file among matches; git grep 128 for a bad pattern
    const failed = engine === 'git-grep' ? result.exitCode === 128 : result.exitCode === 2;

    if (failed && matches.length === 0) {
        throw new ValidationError(`grep failed: ${gitMessage(result)}`);
    }

    if (!failed && result.exitCode !== 0 && result.exitCode !== 1) {
        throw gitFailure('grep', result);
    }

    if (matches.length === 0 && unparsed > 0) {
        throw new SandboxError(`grep output could not be parsed (${engine}): ${cutText(output.trim(), 200)}`);
    }

    return {
        matches: matches.slice(0, limit),
        truncated: matches.length > limit || result.stdoutTruncated,
        engine,
    };
}

export function grepTool(workspaces: CodingWorkspaces): Tool<GrepInput, GrepResult> {
    return defineTool<GrepInput, GrepResult>({
        trust: { taint: (input, ctx) => untrustedWorkspaceResult(workspaces, input, ctx) },
        description: 'Search the text files of the workspace for a regular expression: ripgrep syntax when the image has ripgrep, else ' +
            'POSIX extended (git grep -E, grep -E); the result names the engine. Tracked, untracked and hidden files, git-ignored ones ' +
            `only with includeIgnored. Returns path, 1-based line and the line text (cut at ${LINE_MAX_CHARS} characters). ` +
            'path may also name an output log of bash (~/.chamvi/out/...).',
        inputSchema: objectSchema<GrepInput>({
            pattern: {
                type: 'string',
                minLength: 1,
                description: 'A regular expression.',
            },
            path: PATH,
            ignoreCase: { type: 'boolean', description: 'Match case-insensitively. Default false.' },
            includeIgnored: INCLUDE_IGNORED,
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
            const below = homeLogPath(body.path);
            const path = below ?? optionalPath(body.path);
            const ignoreCase = optionalBoolean(body.ignoreCase, 'ignoreCase') ?? false;
            const includeIgnored = optionalBoolean(body.includeIgnored, 'includeIgnored') ?? false;
            const limit = optionalInteger(body.limit, 'limit', 1, SEARCH_MAX_RESULTS) ?? SEARCH_DEFAULT_RESULTS;
            const workspace = await workspaceOf(workspaces, body, context);

            const result = await workspace.exec([
                'sh',
                '-c',
                GREP_SCRIPT,
                'sh',
                pattern,
                path,
                ignoreCase ? '1' : '0',
                includeIgnored ? '1' : '0',
                below === undefined ? '' : 'home',
            ], { signal: signalOf(abortSignal, context) });

            return grepResult(result, limit, below === undefined ? undefined : body.path as string);
        },
    });
}

/** `git ls-files` of `pathspec` (tracked and untracked, ignored ones with includeIgnored), sorted and cut at `limit`. */
async function listFiles(
    workspaces: CodingWorkspaces,
    body: Record<string, unknown>,
    context: ToolContext,
    input: {
        pathspec: string;
        includeIgnored: boolean;
        limit: number;
        signal: AbortSignal;
        what: string;
    },
): Promise<ListFilesResult> {
    const workspace = await workspaceOf(workspaces, body, context);
    const argv = ['git', 'ls-files', '-z', '--cached', '--others'];

    if (!input.includeIgnored) {
        argv.push('--exclude-standard');
    }

    argv.push('--', input.pathspec);

    const result = await workspace.exec(argv, { signal: input.signal });

    if (result.exitCode !== 0) {
        throw gitFailure(input.what, result);
    }

    const entries = result.stdout.split('\0');

    // the entry after the last NUL is empty, or cut by the output cap
    entries.pop();

    const files = [...new Set(entries)].sort();

    return {
        files: files.slice(0, input.limit),
        truncated: files.length > input.limit || result.stdoutTruncated,
    };
}

export function listFilesTool(workspaces: CodingWorkspaces): Tool<ListFilesInput, ListFilesResult> {
    return defineTool<ListFilesInput, ListFilesResult>({
        trust: { taint: (input, ctx) => untrustedWorkspaceResult(workspaces, input, ctx) },
        description: 'List the files of the workspace (tracked and untracked; git-ignored ones only with includeIgnored), sorted, below an optional path.',
        inputSchema: objectSchema<ListFilesInput>({
            path: PATH,
            includeIgnored: INCLUDE_IGNORED,
            limit: LIMIT,
        }),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const path = optionalPath(body.path);
            const includeIgnored = optionalBoolean(body.includeIgnored, 'includeIgnored') ?? false;
            const limit = optionalInteger(body.limit, 'limit', 1, LIST_MAX_RESULTS) ?? LIST_DEFAULT_RESULTS;

            // literal: a path such as ':!src' names a file, it is no pathspec magic
            return listFiles(workspaces, body, context, {
                pathspec: `:(literal)${path}`,
                includeIgnored,
                limit,
                signal: signalOf(abortSignal, context),
                what: 'list_files',
            });
        },
    });
}

/** A glob pattern relative to the searched path; ValidationError for an absolute one or one with a `..` segment. */
function requirePattern(value: unknown): string {
    const pattern = requireString(value, 'pattern');

    if (pattern.startsWith('/') || pattern.includes('\0') || pattern.split('/').includes('..')) {
        throw new ValidationError('pattern must be relative to path, without .. segments.');
    }

    return pattern;
}

export function globTool(workspaces: CodingWorkspaces): Tool<GlobInput, GlobResult> {
    return defineTool<GlobInput, GlobResult>({
        trust: { taint: (input, ctx) => untrustedWorkspaceResult(workspaces, input, ctx) },
        description: 'Find files of the workspace by a glob pattern relative to path (default the root): * and ? never cross a /, ' +
            '**/ matches any number of directories, e.g. "**/*.ts" or "src/*/index.js". Tracked and untracked files; git-ignored ones only ' +
            'with includeIgnored. Sorted.',
        inputSchema: objectSchema<GlobInput>({
            pattern: {
                type: 'string',
                minLength: 1,
                description: 'A glob pattern, e.g. **/*.test.ts.',
            },
            path: PATH,
            includeIgnored: INCLUDE_IGNORED,
            limit: LIMIT,
        }, ['pattern']),
        execute: async (input, { context, abortSignal }) => {
            const body = inputObject(input);
            const pattern = requirePattern(body.pattern);
            const path = optionalPath(body.path);
            const includeIgnored = optionalBoolean(body.includeIgnored, 'includeIgnored') ?? false;
            const limit = optionalInteger(body.limit, 'limit', 1, LIST_MAX_RESULTS) ?? LIST_DEFAULT_RESULTS;
            // the path is literal inside the glob: escape its glob characters
            const prefix = path === '.' ? '' : `${path.replace(/[*?[\\]/g, '\\$&')}/`;

            return listFiles(workspaces, body, context, {
                pathspec: `:(glob)${prefix}${pattern}`,
                includeIgnored,
                limit,
                signal: signalOf(abortSignal, context),
                what: 'glob',
            });
        },
    });
}
