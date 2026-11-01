/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import {
    basename,
    extname,
    join,
    resolve,
} from 'node:path';
import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { compareCodePoints } from '../repository/helpers.ts';
import { FOLDER_EXTENSIONS, FOLDER_FILE_MAX_BYTES } from './constants.ts';
import { defineKnowledgeSource } from './module.ts';
import type {
    FolderSourceOptions,
    IKnowledgeSource,
    KnowledgeDocumentInput,
    KnowledgeSourceContext,
} from './types.ts';

const TITLE_PATTERN = /^#\s+(.+)$/;

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

const TOO_LARGE = `is larger than ${FOLDER_FILE_MAX_BYTES} bytes`;

function messageOf(error: unknown): string {
    return Error.isError(error) ? error.message : String(error);
}

function normalizeExtensions(extensions: unknown): ReadonlySet<string> {
    if (extensions === undefined) {
        return new Set(FOLDER_EXTENSIONS);
    }

    const valid = Array.isArray(extensions) &&
        extensions.length > 0 &&
        extensions.every((extension) => typeof extension === 'string' && /^\.[^./\\]+$/.test(extension));

    if (!valid) {
        throw new InvalidAgentDefinitionError('folder() extensions must be a non-empty list like [\'.md\'].');
    }

    return new Set(extensions.map((extension: string) => extension.toLowerCase()));
}

async function assertDirectory(root: string, given: string): Promise<void> {
    try {
        if ((await stat(root)).isDirectory()) {
            return;
        }
    } catch {
        // reported below
    }

    throw new InvalidAgentDefinitionError(`folder(): "${given}" is no directory.`);
}

/**
 * Every file under `root` outside dot entries, by relative POSIX path in
 * code-point order. Walks one directory at a time and never enters a
 * symbolic link (reported, so a link to a directory outside the folder or a
 * loop is never read); a subdirectory that cannot be listed is reported,
 * marks the read incomplete and is skipped, the root itself throws.
 */
async function listFiles(root: string, ctx: KnowledgeSourceContext): Promise<string[]> {
    const files: string[] = [];
    const pending: string[] = [''];

    while (pending.length > 0) {
        const directory = pending.pop()!;
        let entries: Dirent[];

        try {
            entries = await readdir(directory === '' ? root : join(root, directory), { withFileTypes: true });
        } catch (error) {
            if (directory === '') {
                throw error;
            }

            const reason = `"${directory}" could not be read (${messageOf(error)})`;

            ctx.onError(new ValidationError(`folder(): ${reason}; skipped.`));
            ctx.incomplete(reason);

            continue;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.')) {
                continue;
            }

            const path = directory === '' ? entry.name : `${directory}/${entry.name}`;

            if (entry.isSymbolicLink()) {
                ctx.onError(new ValidationError(`folder(): "${path}" is a symbolic link; skipped.`));
            } else if (entry.isDirectory()) {
                pending.push(path);
            } else if (entry.isFile()) {
                files.push(path);
            }
        }
    }

    return files.sort(compareCodePoints);
}

/** The file's bytes, else why it is skipped for good (too large, no regular file). */
async function readBounded(file: string): Promise<Uint8Array | string> {
    // O_NOFOLLOW: a file replaced by a link after the listing is refused (ELOOP);
    // O_NONBLOCK: one replaced by a FIFO never blocks the open
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

    try {
        const stats = await handle.stat();

        if (!stats.isFile()) {
            return 'is no regular file';
        }

        const { size } = stats;

        if (size > FOLDER_FILE_MAX_BYTES) {
            return TOO_LARGE;
        }

        // one byte more than the cap, so a file that grew since the stat shows
        const buffer = new Uint8Array(Math.min(size, FOLDER_FILE_MAX_BYTES) + 1);
        let length = 0;

        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);

            if (bytesRead === 0) {
                break;
            }

            length += bytesRead;
        }

        return length > FOLDER_FILE_MAX_BYTES ? TOO_LARGE : buffer.subarray(0, length);
    } finally {
        await handle.close();
    }
}

/** The first `# ` heading outside fenced code blocks (``` and ~~~), else the file name. */
function titleOf(path: string, content: string): string {
    let fence: string | undefined;

    for (const line of content.split(/\r?\n/)) {
        const marker = FENCE_PATTERN.exec(line)?.[1];

        if (fence) {
            // closed by a run of the same character at least as long, with nothing after it
            if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
                fence = undefined;
            }

            continue;
        }

        if (marker) {
            fence = marker;

            continue;
        }

        const heading = TITLE_PATTERN.exec(line)?.[1]?.trim();

        if (heading) {
            return heading;
        }
    }

    return basename(path, extname(path));
}

/**
 * The text files of a directory (Markdown and plain text by default), one
 * document per file: id and source the POSIX path relative to the
 * directory, title the first `# ` heading outside fenced code or the file
 * name. Dot entries are skipped; a symbolic link (a file or a directory,
 * never followed), a file that is no regular file, a file over
 * FOLDER_FILE_MAX_BYTES and a file that is not UTF-8 are reported through
 * `onError` and skipped. A subdirectory that cannot be listed and a file that
 * cannot be read are reported, skipped and mark the read incomplete
 * (`ctx.incomplete()`), so the documents they held stay indexed.
 * `path` is resolved against the cwd when called; a missing directory is an
 * InvalidAgentDefinitionError of `check()` (the boot and `start --check`)
 * and of every read. Trusted by default.
 */
export function folder(path: string, options: FolderSourceOptions = {}): IKnowledgeSource {
    if (typeof path !== 'string' || path.length === 0) {
        throw new InvalidAgentDefinitionError('folder() needs a non-empty path.');
    }

    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('folder() options must be an object.');
    }

    if (options.trusted !== undefined && typeof options.trusted !== 'boolean') {
        throw new InvalidAgentDefinitionError('folder() trusted must be a boolean.');
    }

    const root = resolve(process.cwd(), path);
    const extensions = normalizeExtensions(options.extensions);

    return defineKnowledgeSource({
        kind: 'folder',
        trusted: options.trusted ?? true,
        check: () => assertDirectory(root, path),
        async* documents(ctx): AsyncIterable<KnowledgeDocumentInput> {
            ctx.signal.throwIfAborted();

            await assertDirectory(root, path);

            for (const file of await listFiles(root, ctx)) {
                ctx.signal.throwIfAborted();

                const skip = (reason: string) => ctx.onError(new ValidationError(`folder(): "${file}" ${reason}; skipped.`));

                if (!extensions.has(extname(file).toLowerCase())) {
                    continue;
                }

                let bytes: Uint8Array | string;

                try {
                    bytes = await readBounded(join(root, file));
                } catch (error) {
                    if (isObject(error) && error.code === 'ELOOP') {
                        skip('is a symbolic link');
                    } else {
                        // perhaps transient: the document it was stays indexed
                        const reason = `could not be read (${messageOf(error)})`;

                        skip(reason);
                        ctx.incomplete(`"${file}" ${reason}`);
                    }

                    continue;
                }

                if (typeof bytes === 'string') {
                    skip(bytes);

                    continue;
                }

                let content: string;

                try {
                    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                } catch {
                    skip('is not valid UTF-8');

                    continue;
                }

                yield {
                    id: file,
                    source: file,
                    title: titleOf(file, content),
                    content,
                };
            }
        },
    });
}
