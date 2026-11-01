/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { mockEmbeddingModel } from '@chamvi/test-kit';
import { describe, expect, it } from 'vitest';
import { defineKnowledgeSource, folder, knowledgeCollection } from '@chamvi/knowledge';

const custom = defineKnowledgeSource({
    async* documents() {
        yield* [];
    }, 
});

describe('knowledgeCollection', () => {
    it('builds a definition', () => {
        const model = mockEmbeddingModel();
        const definition = knowledgeCollection('docs', { model, sources: [custom] });

        expect(definition).toEqual({
            name: 'docs',
            model,
            sources: [custom],
            trusted: true,
        });
    });

    it('follows the agent-name rule', () => {
        for (const name of ['', 'Docs', 'my_docs', '-docs', 'docs-', 'a--b', 'a'.repeat(65), 42]) {
            expect(() => knowledgeCollection(name as never, { model: 'openai/x', sources: [custom] }))
                .toThrow(InvalidAgentDefinitionError);
        }

        expect(knowledgeCollection('a'.repeat(64), { model: 'openai/x', sources: [custom] }).name).toHaveLength(64);
        expect(knowledgeCollection('api-docs-2', { model: 'openai/x', sources: [custom] }).name).toBe('api-docs-2');
    });

    it('needs at least one source', () => {
        expect(() => knowledgeCollection('docs', { model: 'openai/x', sources: [] }))
            .toThrow(/at least one source/);
        expect(() => knowledgeCollection('docs', { model: 'openai/x', sources: [{}] as never }))
            .toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeCollection('docs', { model: 'openai/x' } as never))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a model that is no ref', () => {
        expect(() => knowledgeCollection('docs', { model: '', sources: [custom] })).toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeCollection('docs', { model: 42 as never, sources: [custom] })).toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeCollection('docs', { model: {} as never, sources: [custom] })).toThrow(InvalidAgentDefinitionError);
    });

    it('derives trusted from the sources, an explicit value winning', () => {
        const trusted = folder('.');
        const untrusted = folder('.', { trusted: false });

        expect(knowledgeCollection('docs', { model: 'openai/x', sources: [trusted, custom] }).trusted).toBe(true);
        expect(knowledgeCollection('docs', { model: 'openai/x', sources: [trusted, untrusted] }).trusted).toBe(false);
        expect(knowledgeCollection('docs', {
            model: 'openai/x', 
            sources: [untrusted], 
            trusted: true, 
        }).trusted).toBe(true);
        expect(knowledgeCollection('docs', {
            model: 'openai/x', 
            sources: [trusted], 
            trusted: false, 
        }).trusted).toBe(false);
        expect(() => knowledgeCollection('docs', {
            model: 'openai/x', 
            sources: [trusted], 
            trusted: 'yes' as never, 
        }))
            .toThrow(InvalidAgentDefinitionError);
    });
});
