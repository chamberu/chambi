/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { FilePart, ModelMessage } from 'ai';
import { isObject } from 'smob';
import { ArtifactNotFoundError, ValidationError } from '../errors/index.ts';
import type { IArtifactRepository } from '../repository/types.ts';
import { ARTIFACT_URI_PREFIX } from './constants.ts';
import { isArtifactMediaType } from './media-type.ts';
import type { Artifact, ArtifactInput } from './types.ts';

/** Throws ValidationError unless `input` is an ArtifactInput (`what` names it in the message). */
export function assertArtifactInput(input: unknown, what = 'artifact'): asserts input is ArtifactInput {
    if (!isObject(input)) throw new ValidationError(`The ${what} must be an object.`);
    if (!isArtifactMediaType(input.mediaType)) {
        throw new ValidationError(`The ${what} needs a mediaType of the form type/subtype.`);
    }
    if (input.filename !== undefined && typeof input.filename !== 'string') {
        throw new ValidationError(`The ${what} filename must be a string.`);
    }
    if (!(input.data instanceof Uint8Array)) {
        throw new ValidationError(`The ${what} data must be a Uint8Array.`);
    }
}

/** The file part a checkpoint keeps for an artifact: the marker instead of the bytes. */
export function toFilePart(artifact: Artifact): FilePart {
    return {
        type: 'file',
        mediaType: artifact.mediaType,
        ...(artifact.filename === undefined ? {} : { filename: artifact.filename }),
        data: `${ARTIFACT_URI_PREFIX}${artifact.id}`,
    };
}

function markerIdOf(data: unknown): string | undefined {
    if (typeof data !== 'string' || !data.startsWith(ARTIFACT_URI_PREFIX)) return undefined;
    return data.slice(ARTIFACT_URI_PREFIX.length);
}

/** The artifact id of a file part whose data is the marker (a prompt's `toFilePart()`). */
function artifactIdOf(part: unknown): string | undefined {
    if (!isObject(part) || part.type !== 'file') return undefined;
    return markerIdOf(part.data);
}

/** The artifact id of a tool result's file item whose tagged data is the marker (`artifactFilePart()`). */
function toolFileIdOf(item: unknown): string | undefined {
    if (!isObject(item) || item.type !== 'file' || !isObject(item.data) || item.data.type !== 'data') return undefined;
    return markerIdOf(item.data.data);
}

/** The items of a tool-result part's content output; empty for any other part. */
function toolContentOf(part: unknown): unknown[] {
    if (!isObject(part) || part.type !== 'tool-result' || !isObject(part.output)) return [];
    const { output } = part;
    return output.type === 'content' && Array.isArray(output.value) ? output.value : [];
}

/** A copy of a tool-result part (`toolContentOf()` non-empty) whose marked file items carry the bytes. */
function hydrateToolResult<T>(part: T, bytes: Map<string, Uint8Array>): T {
    const result = part as Record<string, unknown>;
    return {
        ...result,
        output: {
            ...(result.output as Record<string, unknown>),
            value: toolContentOf(part).map((item) => {
                const id = toolFileIdOf(item);
                if (id === undefined) return item;
                const file = item as Record<string, unknown>;
                return { ...file, data: { ...(file.data as Record<string, unknown>), data: bytes.get(id)! } };
            }),
        },
    } as T;
}

/**
 * A copy of `messages` for the model: every file part whose data is an
 * artifact marker carries the artifact's bytes instead, also a file item of
 * a tool result's content (`artifactFilePart()`). `messages` is not changed;
 * without a marker it is returned as is. Throws ArtifactNotFoundError for a
 * marker whose artifact is gone.
 */
export async function hydrateMessages(messages: ModelMessage[], store: IArtifactRepository): Promise<ModelMessage[]> {
    const ids = new Set<string>();
    for (const message of messages) {
        if (typeof message.content === 'string') continue;
        for (const part of message.content) {
            const id = artifactIdOf(part);
            if (id !== undefined) ids.add(id);
            for (const item of toolContentOf(part)) {
                const toolId = toolFileIdOf(item);
                if (toolId !== undefined) ids.add(toolId);
            }
        }
    }
    if (ids.size === 0) return messages;

    const bytes = new Map<string, Uint8Array>();
    for (const id of ids) {
        const data = await store.read(id);
        if (!data) throw new ArtifactNotFoundError(id);
        bytes.set(id, data);
    }
    return messages.map((message) => {
        if (typeof message.content === 'string') return message;
        return {
            ...message,
            content: message.content.map((part) => {
                const id = artifactIdOf(part);
                if (id !== undefined) return { ...part, data: bytes.get(id)! };
                if (toolContentOf(part).some((item) => toolFileIdOf(item) !== undefined)) {
                    return hydrateToolResult(part, bytes);
                }
                return part;
            }),
        } as ModelMessage;
    });
}
