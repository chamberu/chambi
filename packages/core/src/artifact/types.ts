/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolResultPart } from 'ai';

/** Metadata of a file stored for a run (an attachment or a tool output); the bytes are read separately. */
export type Artifact = {
    id: string;
    runId: string;
    agent: string;
    mediaType: string;
    filename?: string;
    /** Byte length of the data. */
    size: number;
    createdAt: Date;
};

/** A file to store: an attachment at dispatch or a tool's `artifacts.put()`. */
export type ArtifactInput = {
    /** `type/subtype`, e.g. `image/png`. */
    mediaType: string;
    filename?: string;
    data: Uint8Array;
};

/**
 * The artifacts of one run, part of the tool context. Not an effect by
 * itself: put `put()` inside a `defineEffectTool` to store a file exactly once.
 */
/**
 * The file item of a tool's `toModelOutput` content for an artifact
 * (`artifactFilePart()`): its data is the artifact's marker, which the
 * engine swaps for the bytes before each model call.
 */
export type ArtifactFilePart = Extract<
    Extract<ToolResultPart['output'], { type: 'content' }>['value'][number],
    { type: 'file' }
>;

export interface IRunArtifacts {
    /** Stores a file as an artifact of the run. Throws ValidationError for an invalid input. */
    put(input: ArtifactInput): Promise<Artifact>;
    /** An artifact of this run with its bytes; undefined for an unknown id or another run's artifact. */
    get(id: string): Promise<{ artifact: Artifact; data: Uint8Array } | undefined>;
    /** The run's artifacts, by createdAt then id. */
    list(): Promise<Artifact[]>;
}
