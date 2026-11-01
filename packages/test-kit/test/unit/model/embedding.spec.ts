/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { embed, embedMany } from 'ai';
import { describe, expect, it } from 'vitest';
import { mockEmbeddingModel } from '@chamvi/test-kit';

function cosine(a: number[], b: number[]): number {
    return a.reduce((sum, value, index) => sum + (value * b[index]!), 0);
}

function norm(vector: number[]): number {
    return Math.sqrt(cosine(vector, vector));
}

describe('mockEmbeddingModel', () => {
    it('gives identical texts identical vectors', async () => {
        const model = mockEmbeddingModel();
        const { embeddings } = await embedMany({ model, values: ['Refund policy', 'refund   POLICY!'] });

        expect(embeddings[0]).toEqual(embeddings[1]);
    });

    it('gives vectors of the configured length, 64 by default', async () => {
        const { embedding } = await embed({ model: mockEmbeddingModel(), value: 'hello world' });
        const { embedding: small } = await embed({ model: mockEmbeddingModel({ dimensions: 8 }), value: 'hello world' });

        expect(embedding).toHaveLength(64);
        expect(small).toHaveLength(8);
    });

    it('gives unit length vectors', async () => {
        const { embeddings } = await embedMany({
            model: mockEmbeddingModel(),
            values: ['a', 'the quick brown fox', 'one one one two'],
        });

        for (const vector of embeddings) {
            expect(norm(vector)).toBeCloseTo(1, 10);
        }
    });

    it('scores texts sharing words higher', async () => {
        const { embeddings: [query, near, far] } = await embedMany({
            model: mockEmbeddingModel(),
            values: ['refund policy', 'our refund policy', 'kubernetes pods'],
        });

        expect(cosine(query!, near!)).toBeGreaterThan(cosine(query!, far!));
    });

    it('records every call with its values', async () => {
        const model = mockEmbeddingModel();

        await embedMany({ model, values: ['a', 'b'] });
        await embed({ model, value: 'c' });

        expect(model.calls).toHaveLength(2);
        expect(model.calls.map((call) => call.values)).toEqual([['a', 'b'], ['c']]);
    });

    it('refuses dimensions outside 1 to 8192', () => {
        for (const dimensions of [0, 1.5, 8193, 2 ** 32]) {
            expect(() => mockEmbeddingModel({ dimensions })).toThrow(InvalidAgentDefinitionError);
        }

        expect(mockEmbeddingModel({ dimensions: 8192 })).toBeDefined();
    });

    it('keeps the mock provider and model id', () => {
        const model = mockEmbeddingModel();

        expect(model.provider).toBe('mock-provider');
        expect(model.modelId).toBe('mock-model-id');
    });
});
