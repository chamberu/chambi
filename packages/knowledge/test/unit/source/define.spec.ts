/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import { describe, expect, it } from 'vitest';
import type { IKnowledgeSource, KnowledgeDocumentInput } from '@chamvi/knowledge';
import { defineKnowledgeSource } from '@chamvi/knowledge';

async function collect(source: IKnowledgeSource): Promise<{ documents: KnowledgeDocumentInput[]; errors: unknown[] }> {
    const documents: KnowledgeDocumentInput[] = [];
    const errors: unknown[] = [];

    for await (const document of source.documents({
        signal: new AbortController().signal,
        onError: (error) => {
            errors.push(error);
        }, 
    })) {
        documents.push(document);
    }

    return { documents, errors };
}

describe('defineKnowledgeSource', () => {
    it('defaults to a trusted custom source', () => {
        const source = defineKnowledgeSource({
            async* documents() {
                yield* [];
            }, 
        });

        expect(source.kind).toBe('custom');
        expect(source.trusted).toBe(true);
    });

    it('keeps a given kind and trust', () => {
        const source = defineKnowledgeSource({
            kind: 'crm', 
            trusted: false, 
            async* documents() {
                yield* [];
            }, 
        });

        expect(source.kind).toBe('crm');
        expect(source.trusted).toBe(false);
    });

    it('keeps a check of the source, and has none without one', async () => {
        let checked = 0;
        const source = defineKnowledgeSource({
            check: async () => {
                checked++;
            },
            async* documents() {
                yield* [];
            },
        });

        await source.check!();
        expect(checked).toBe(1);
        expect(defineKnowledgeSource({
            async* documents() {
                yield* [];
            },
        }).check).toBeUndefined();
        expect(() => defineKnowledgeSource({
            check: 'no',
            async* documents() {
                yield* [];
            },
        } as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a bad definition', () => {
        expect(() => defineKnowledgeSource(undefined as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => defineKnowledgeSource({ documents: 'nope' } as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => defineKnowledgeSource({
            kind: '',
            async* documents() {
                yield* [];
            }, 
        })).toThrow(InvalidAgentDefinitionError);
        expect(() => defineKnowledgeSource({
            trusted: 'yes',
            async* documents() {
                yield* [];
            }, 
        } as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('passes valid items through unchanged', async () => {
        const items: KnowledgeDocumentInput[] = [
            { id: 'a', content: 'alpha' },
            {
                id: 'b', 
                content: '', 
                title: 'B', 
                source: 'crm://b', 
                metadata: { tag: 'x' }, 
            },
        ];
        const source = defineKnowledgeSource({
            async* documents() {
                yield* items;
            },
        });

        const { documents, errors } = await collect(source);

        expect(documents).toEqual(items);
        expect(documents[0]).toBe(items[0]);
        expect(errors).toEqual([]);
    });

    it('reports and skips invalid items, naming the id but never the content', async () => {
        const source = defineKnowledgeSource({
            async* documents() {
                yield { id: '', content: 'secret one' };
                yield { id: 'x'.repeat(256), content: 'secret two' };
                yield { id: 'nul\0id', content: 'secret three' };
                yield { id: 'number', content: 42 } as never;
                yield {
                    id: 'meta', 
                    content: 'secret four', 
                    metadata: ['a'], 
                } as never;
                yield 'not an object' as never;
                yield { id: 'ok', content: 'fine' };
            },
        });

        const { documents, errors } = await collect(source);

        expect(documents.map((document) => document.id)).toEqual(['ok']);
        expect(errors).toHaveLength(6);

        for (const error of errors) {
            expect(error).toBeInstanceOf(ValidationError);
            expect((error as Error).message).not.toMatch(/secret/);
        }

        expect((errors[3] as Error).message).toContain('"number"');
        expect((errors[4] as Error).message).toContain('"meta"');
    });

    it('hands the context to the source', async () => {
        const controller = new AbortController();
        let seen: AbortSignal | undefined;
        const source = defineKnowledgeSource({
            async* documents(ctx) {
                seen = ctx.signal;
                yield { id: 'a', content: 'alpha' };
            },
        });

        const iterator = source.documents({ signal: controller.signal, onError: () => {} })[Symbol.asyncIterator]();

        await iterator.next();

        expect(seen).toBe(controller.signal);
    });
});
