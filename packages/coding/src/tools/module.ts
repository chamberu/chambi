/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { editFileTool, multiEditTool } from './edit.ts';
import { readFileTool, writeFileTool } from './files.ts';
import { gitDiffTool } from './git.ts';
import { createKeyedQueue } from './helpers.ts';
import { bashKillTool, bashOutputTool } from './jobs.ts';
import { globTool, grepTool, listFilesTool } from './search.ts';
import { bashTool } from './shell.ts';
import { OUTPUT_LOG_MAX_BYTES } from './constants.ts';
import type { CodingToolsOptions, CodingWorkspaces } from './types.ts';

/**
 * The coding tools: read_file, write_file, edit_file, grep, list_files,
 * bash and git_diff. Each works in a workspace of the calling run
 * (`context.run.runId`), named by its optional `workspace` id or the run's
 * only one. Plain chamvi tools, not effect tools: a workspace dies with
 * its process, so a recorded result would outlive it. write_file and
 * edit_file of one file run one after the other (the AI SDK runs a step's
 * calls at once), so parallel edits of one file all apply.
 * `outputLogMaxBytes` caps each output log of bash (default
 * `OUTPUT_LOG_MAX_BYTES`).
 */
export function codingTools(workspaces: CodingWorkspaces, options: CodingToolsOptions = {}): ToolSet {
    if (!isObject(workspaces) || typeof workspaces.get !== 'function') {
        throw new InvalidAgentDefinitionError('codingTools() needs a workspace manager (get).');
    }

    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('codingTools() options must be an object.');
    }

    if (options.repositoryInstructions !== undefined && typeof options.repositoryInstructions !== 'boolean') {
        throw new InvalidAgentDefinitionError('codingTools() repositoryInstructions must be a boolean.');
    }

    const outputLogMaxBytes = options.outputLogMaxBytes ?? OUTPUT_LOG_MAX_BYTES;

    if (!Number.isSafeInteger(outputLogMaxBytes) || outputLogMaxBytes < 1) {
        throw new InvalidAgentDefinitionError('codingTools() outputLogMaxBytes must be a positive integer.');
    }

    const queue = createKeyedQueue();

    return {
        read_file: readFileTool(workspaces, options.repositoryInstructions ?? true),
        write_file: writeFileTool(workspaces, queue),
        edit_file: editFileTool(workspaces, queue),
        multi_edit: multiEditTool(workspaces, queue),
        grep: grepTool(workspaces),
        list_files: listFilesTool(workspaces),
        glob: globTool(workspaces),
        bash: bashTool(workspaces, outputLogMaxBytes),
        bash_output: bashOutputTool(workspaces, outputLogMaxBytes),
        bash_kill: bashKillTool(workspaces),
        git_diff: gitDiffTool(workspaces),
    };
}
