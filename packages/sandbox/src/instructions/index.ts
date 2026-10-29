/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export {
    INSTRUCTION_DIAGNOSTICS_MAX,
    INSTRUCTION_DIAGNOSTICS_MAX_BYTES,
    INSTRUCTION_DIRECTORIES_MAX,
    INSTRUCTION_EXEC_TIMEOUT_MS,
    INSTRUCTION_FILES,
    INSTRUCTION_INCLUDE_DEPTH_MAX,
    INSTRUCTION_PATHS_MAX,
    INSTRUCTION_PATH_MAX_BYTES,
    INSTRUCTION_REFERENCES_MAX,
    INSTRUCTION_REQUEST_TIMEOUT_MS,
    INSTRUCTION_SOURCES_MAX,
    INSTRUCTION_SOURCE_MAX_BYTES,
    INSTRUCTION_TOTAL_MAX_BYTES,
} from './constants.ts';
export { readRepositoryInstructions } from './module.ts';
export type {
    ReadRepositoryInstructionsOptions,
    RepositoryInstructionDiagnostic,
    RepositoryInstructionDiagnosticCode,
    RepositoryInstructionSource,
    RepositoryInstructions,
} from './types.ts';
