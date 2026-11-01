/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import { REDACTED } from '@chamvi/sandbox';
import type { IWorkspace } from '@chamvi/sandbox';
import { FILE_PATH_PROPERTY, MULTI_EDIT_MAX_EDITS } from './constants.ts';
import {
    fileKey,
    inputObject,
    objectSchema,
    optionalBoolean,
    readRawText,
    requirePath,
    requireString,
    requireText,
    workspaceOf,
} from './helpers.ts';
import type { createKeyedQueue } from './helpers.ts';
import type { CodingWorkspaces, EditFileResult, MultiEditResult } from './types.ts';

/** Serializes the writes of one file: keyed by `fileKey()`. */
type FileQueue = ReturnType<typeof createKeyedQueue>;

type Edit = {
    oldString: string;
    newString: string;
    replaceAll?: boolean;
};

type EditFileInput = Edit & {
    path: string;
    workspace?: string;
};

type MultiEditInput = {
    path: string;
    edits: Edit[];
    workspace?: string;
};

const EDIT_PROPERTIES = {
    oldString: {
        type: 'string',
        minLength: 1,
        description: 'The exact text to replace.',
    },
    newString: { type: 'string', description: 'The text to put in its place.' },
    replaceAll: { type: 'boolean', description: 'Replace every match instead of exactly one. Default false.' },
} as const;

/** One edit of the input, checked; `label` names it in errors (`edit 2: `). */
function readEdit(value: unknown, label = ''): Required<Edit> {
    const body = inputObject(value);
    const oldString = requireString(body.oldString, `${label}oldString`);
    const newString = requireText(body.newString, `${label}newString`);
    const replaceAll = optionalBoolean(body.replaceAll, `${label}replaceAll`) ?? false;

    if (oldString === newString) {
        throw new ValidationError(`${label}oldString and newString are the same: nothing to change.`);
    }

    return {
        oldString,
        newString,
        replaceAll,
    };
}

/**
 * The text the edits run on: what the model read (`read_file`), each span
 * the workspace redacts a `[redacted]` marker at `at` standing for its raw
 * token. Matching never sees a token, so an oldString cannot probe one, and
 * `rawText()` puts every untouched token back byte for byte.
 */
type EditDocument = {
    text: string;
    markers: Array<{ at: number; raw: string }>;
};

async function readDocument(workspace: IWorkspace, path: string): Promise<EditDocument> {
    const raw = await readRawText(workspace, path);
    const spans = workspace.redactedSpans?.(raw) ?? [];

    if (spans.length === 0) {
        return { text: raw, markers: [] };
    }

    let text = '';
    let from = 0;
    const markers: EditDocument['markers'] = [];

    for (const span of spans) {
        text += raw.slice(from, span.start);
        markers.push({ at: text.length, raw: raw.slice(span.start, span.end) });
        text += REDACTED;
        from = span.end;
    }

    return { text: text + raw.slice(from), markers };
}

function rawText(document: EditDocument): string {
    let raw = '';
    let from = 0;

    for (const marker of document.markers) {
        raw += `${document.text.slice(from, marker.at)}${marker.raw}`;
        from = marker.at + REDACTED.length;
    }

    return raw + document.text.slice(from);
}

/**
 * The text `write_file` writes for `content`: a file holding redacted tokens
 * gets each back where `content` keeps a `[redacted]` of the text the model
 * read (the occurrences in order, a literal `[redacted]` of the file staying
 * literal), so a read and write round trip never writes the marker over a
 * token. ValidationError when the occurrences do not line up with the
 * file's; `content` itself for a file without a token (or a missing one).
 */
export async function restoreRedacted(workspace: IWorkspace, path: string, content: string): Promise<string> {
    if (!workspace.redactedSpans || !content.includes(REDACTED)) {
        return content;
    }

    let document: EditDocument;

    try {
        document = await readDocument(workspace, path);
    } catch {
        // a missing or unreadable file holds no token the write could clobber
        return content;
    }

    if (document.markers.length === 0) {
        return content;
    }

    // every [redacted] of the text the model read: a token's marker, or one literally in the file
    const tokens = new Map(document.markers.map((marker) => [marker.at, marker.raw]));
    const shown: Array<string | undefined> = [];

    for (let at = document.text.indexOf(REDACTED); at !== -1; at = document.text.indexOf(REDACTED, at + REDACTED.length)) {
        shown.push(tokens.get(at));
    }

    const parts = content.split(REDACTED);

    if (parts.length - 1 !== shown.length) {
        throw new ValidationError(`content holds ${parts.length - 1} [redacted] where ${path} shows ${shown.length} over a redacted credential: ` +
            'keep each [redacted] of the text read_file returned, in order, or change the file with edit_file.');
    }

    return parts.reduce((text, part, index) => (index === 0 ? part : `${text}${shown[index - 1] ?? REDACTED}${part}`), '');
}

/**
 * `document` with `edit` applied, and how often; ValidationError when it has
 * no or (without replaceAll) several matches, or touches a redacted span.
 */
function applyEdit(document: EditDocument, edit: Required<Edit>, path: string, label = ''): { document: EditDocument; replacements: number } {
    const {
        oldString,
        newString,
        replaceAll,
    } = edit;
    const { text, markers } = document;
    // the leftmost non-overlapping matches, as split() finds them
    const matches: number[] = [];

    for (let at = text.indexOf(oldString); at !== -1; at = text.indexOf(oldString, at + oldString.length)) {
        matches.push(at);
    }

    if (matches.length === 0) {
        throw new ValidationError(`${label}oldString not found in ${path}. Read the file and copy the text exactly.`);
    }

    if (matches.length > 1 && !replaceAll) {
        throw new ValidationError(`${label}oldString has ${matches.length} matches in ${path}: add surrounding text to make it unique, or pass replaceAll: true.`);
    }

    const targets = replaceAll ? matches : matches.slice(0, 1);
    const touches = targets.some((at) => markers.some((marker) => at < marker.at + REDACTED.length && marker.at < at + oldString.length));

    if (touches) {
        throw new ValidationError(`${label}oldString overlaps a redacted credential in ${path}: edit the text around [redacted] only.`);
    }

    // plain concatenation: replace() would expand `$&` and friends in newString
    let next = '';
    let from = 0;

    for (const at of targets) {
        next += `${text.slice(from, at)}${newString}`;
        from = at + oldString.length;
    }

    next += text.slice(from);

    const delta = newString.length - oldString.length;
    const moved = markers.map((marker) => ({
        at: marker.at + delta * targets.filter((at) => at < marker.at).length,
        raw: marker.raw,
    }));

    return {
        document: { text: next, markers: moved },
        replacements: targets.length,
    };
}

export function editFileTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<EditFileInput, EditFileResult> {
    return defineTool<EditFileInput, EditFileResult>({
        description: 'Replace an exact string in a file of the workspace. oldString must match the file exactly (whitespace included) and only once, ' +
            'unless replaceAll is true; add surrounding lines to make it unique. For several changes to one file use multi_edit. ' +
            'Before editing in a new subtree, obtain its repository guidance with read_file or read_repository_instructions (when available).',
        inputSchema: objectSchema<EditFileInput>({ path: FILE_PATH_PROPERTY, ...EDIT_PROPERTIES }, ['path', 'oldString', 'newString']),
        execute: async (input, { context }) => {
            const body = inputObject(input);
            const path = requirePath(body.path);
            const edit = readEdit(body);
            const workspace = await workspaceOf(workspaces, body, context);

            // read, change and write in one turn of the file's queue
            return queue(fileKey(workspace.id, path), async () => {
                const result = applyEdit(await readDocument(workspace, path), edit, path);

                await workspace.writeFile(path, rawText(result.document));

                return { path, replacements: result.replacements };
            });
        },
    });
}

export function multiEditTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<MultiEditInput, MultiEditResult> {
    return defineTool<MultiEditInput, MultiEditResult>({
        description: 'Apply several exact-string edits to one file of the workspace, in order, each on the result of the ones before ' +
            '(the rules of edit_file per edit). Every edit must match: when one fails, nothing is written. ' +
            'Before editing in a new subtree, obtain its repository guidance with read_file or read_repository_instructions (when available).',
        inputSchema: objectSchema<MultiEditInput>({
            path: FILE_PATH_PROPERTY,
            edits: {
                type: 'array',
                minItems: 1,
                maxItems: MULTI_EDIT_MAX_EDITS,
                items: {
                    type: 'object',
                    properties: { ...EDIT_PROPERTIES },
                    required: ['oldString', 'newString'],
                    additionalProperties: false,
                },
            },
        }, ['path', 'edits']),
        execute: async (input, { context }) => {
            const body = inputObject(input);
            const path = requirePath(body.path);

            if (!Array.isArray(body.edits) || body.edits.length === 0 || body.edits.length > MULTI_EDIT_MAX_EDITS) {
                throw new ValidationError(`edits must be a list of 1 to ${MULTI_EDIT_MAX_EDITS} edits.`);
            }

            const edits = body.edits.map((edit: unknown, index) => readEdit(edit, `edit ${index + 1}: `));
            const workspace = await workspaceOf(workspaces, body, context);

            return queue(fileKey(workspace.id, path), async () => {
                let document = await readDocument(workspace, path);
                let replacements = 0;

                edits.forEach((edit, index) => {
                    const result = applyEdit(document, edit, path, `edit ${index + 1}: `);

                    document = result.document;
                    replacements += result.replacements;
                });
                await workspace.writeFile(path, rawText(document));

                return {
                    path,
                    edits: edits.length,
                    replacements,
                };
            });
        },
    });
}
