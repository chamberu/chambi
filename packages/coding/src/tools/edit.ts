/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import { FILE_PATH_PROPERTY, MULTI_EDIT_MAX_EDITS } from './constants.ts';
import {
    fileKey,
    inputObject,
    objectSchema,
    optionalBoolean,
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

/** `text` with `edit` applied, and how often; ValidationError when it has no or (without replaceAll) several matches. */
function applyEdit(text: string, edit: Required<Edit>, path: string, label = ''): { text: string; replacements: number } {
    const {
        oldString, 
        newString, 
        replaceAll, 
    } = edit;
    const parts = text.split(oldString);
    const count = parts.length - 1;
    if (count === 0) {
        throw new ValidationError(`${label}oldString not found in ${path}. Read the file and copy the text exactly.`);
    }
    if (count > 1 && !replaceAll) {
        throw new ValidationError(`${label}oldString has ${count} matches in ${path}: add surrounding text to make it unique, or pass replaceAll: true.`);
    }
    // split/join: replace() would expand `$&` and friends in newString
    return {
        text: replaceAll ? parts.join(newString) : `${parts[0]}${newString}${parts.slice(1).join(oldString)}`,
        replacements: replaceAll ? count : 1,
    };
}

export function editFileTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<EditFileInput, EditFileResult> {
    return defineTool<EditFileInput, EditFileResult>({
        description: 'Replace an exact string in a file of the workspace. oldString must match the file exactly (whitespace included) and only once, ' +
            'unless replaceAll is true; add surrounding lines to make it unique. For several changes to one file use multi_edit.',
        inputSchema: objectSchema<EditFileInput>({ path: FILE_PATH_PROPERTY, ...EDIT_PROPERTIES }, ['path', 'oldString', 'newString']),
        execute: async (input, { context }) => {
            const body = inputObject(input);
            const path = requirePath(body.path);
            const edit = readEdit(body);
            const workspace = await workspaceOf(workspaces, body, context);

            // read, change and write in one turn of the file's queue
            return queue(fileKey(workspace.id, path), async () => {
                const result = applyEdit(await workspace.readFile(path), edit, path);
                await workspace.writeFile(path, result.text);
                return { path, replacements: result.replacements };
            });
        },
    });
}

export function multiEditTool(workspaces: CodingWorkspaces, queue: FileQueue): Tool<MultiEditInput, MultiEditResult> {
    return defineTool<MultiEditInput, MultiEditResult>({
        description: 'Apply several exact-string edits to one file of the workspace, in order, each on the result of the ones before ' +
            '(the rules of edit_file per edit). Every edit must match: when one fails, nothing is written.',
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
                let text = await workspace.readFile(path);
                let replacements = 0;
                edits.forEach((edit, index) => {
                    const result = applyEdit(text, edit, path, `edit ${index + 1}: `);
                    text = result.text;
                    replacements += result.replacements;
                });
                await workspace.writeFile(path, text);
                return {
                    path, 
                    edits: edits.length, 
                    replacements, 
                };
            });
        },
    });
}
