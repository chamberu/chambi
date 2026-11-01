/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { MockEmbeddingModelV4 } from 'ai/test';

import type { MockEmbeddingModel, MockEmbeddingModelOptions } from './types.ts';

const TOKEN_PATTERN = /\w+/g;

/**
 * Hashed bag of words: every lower-cased `\w+` token adds one to the
 * dimension its sha256 picks, then the vector is L2-normalized (a text
 * without a token stays the zero vector).
 */
function embedText(text: string, dimensions: number): number[] {
    const vector: number[] = Array.from({ length: dimensions }, () => 0);

    for (const [token] of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
        const digest = createHash('sha256').update(token).digest();

        vector[digest.readUInt32BE(0) % dimensions]! += 1;
    }

    const length = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));

    return length === 0 ? vector : vector.map((value) => value / length);
}

/**
 * A deterministic embedding model for tests, with no network: texts sharing
 * words score higher under cosine similarity. One `embed`/`embedMany` call is
 * one model call, recorded in `calls`. Provider and model id are the AI SDK
 * mock's defaults (`mock-provider`, `mock-model-id`).
 */
export function mockEmbeddingModel(options: MockEmbeddingModelOptions = {}): MockEmbeddingModel {
    const dimensions = options.dimensions ?? 64;

    if (!Number.isSafeInteger(dimensions) || dimensions < 1) {
        throw new InvalidAgentDefinitionError('mockEmbeddingModel(): dimensions must be a positive integer.');
    }

    const model = new MockEmbeddingModelV4({
        maxEmbeddingsPerCall: null,
        supportsParallelCalls: true,
        doEmbed: async ({ values }) => ({
            embeddings: values.map((value) => embedText(value, dimensions)),
            warnings: [],
        }),
    });

    return Object.assign(model, { calls: model.doEmbedCalls });
}
