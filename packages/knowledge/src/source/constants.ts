/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The file extensions folder() reads by default (compared case-insensitively). */
export const FOLDER_EXTENSIONS: readonly string[] = Object.freeze(['.md', '.markdown', '.mdx', '.txt']);

/** folder() skips (and reports) a file larger than this. */
export const FOLDER_FILE_MAX_BYTES = 1_048_576;

/** A document id is 1 to this many characters, without NUL. */
export const KNOWLEDGE_DOCUMENT_ID_MAX_LENGTH = 255;
