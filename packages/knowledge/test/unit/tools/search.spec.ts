/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { embed } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    ContextNotProvidedError,
    Engine,
    InvalidAgentDefinitionError,
    ValidationError,
    createMemoryStore,
} from '@chamvi/core';
import { mockEmbeddingModel } from '@chamvi/test-kit';
import type { MockEmbeddingModel } from '@chamvi/test-kit';
import type { IKnowledge, KnowledgeSearchResult } from '@chamvi/knowledge';
import {
    KNOWLEDGE_QUERY_MAX_LENGTH,
    KNOWLEDGE_SEARCH_DEFAULT_RESULTS,
    KNOWLEDGE_SEARCH_MAX_CHARS,
    KNOWLEDGE_SEARCH_MAX_RESULTS,
    createKnowledge,
    defineKnowledgeSource,
    injectKnowledgeContext,
    knowledgeCollection,
    knowledgeTools,
    provideKnowledgeContext,
} from '@chamvi/knowledge';
import type { IndexerSetup } from '../../utils/indexer.ts';
import { createIndexerSetup, embeddingResolver, waitForReady } from '../../utils/indexer.ts';
import { callTool, seedCollection, toolContext } from '../../utils/tools.ts';

const HANDBOOK = {
    refunds: 'Our refund policy: a refund is paid within 30 days.',
    pods: 'Kubernetes pods restart when a container fails.',
    invoices: 'Invoices are sent at the end of every month.',
};

const MODEL = 'test/embed';

let knowledge: IKnowledge | undefined;

afterEach(async () => {
    await knowledge?.stop();
    knowledge = undefined;
});

type Fixture = IndexerSetup & { model: MockEmbeddingModel; knowledge: IKnowledge };

/** A knowledge with the declared, indexed collection `handbook` and the resolver ref `test/embed`. */
async function setup(options: { index?: boolean } = {}): Promise<Fixture> {
    const indexer = createIndexerSetup();
    const model = mockEmbeddingModel();
    const handbook = knowledgeCollection('handbook', {
        model,
        sources: [defineKnowledgeSource({
            async* documents() {
                for (const [id, content] of Object.entries(HANDBOOK)) {
                    yield {
                        id,
                        content,
                        title: `Handbook: ${id}`,
                        source: `handbook/${id}.md`,
                    };
                }
            },
        })],
    });

    knowledge = createKnowledge(indexer.options({
        collections: [handbook],
        models: embeddingResolver({ [MODEL]: model }),
    }));

    if (options.index !== false) {
        knowledge.start();
        await waitForReady(indexer.repository, 'handbook');
    }

    return {
        ...indexer,
        model,
        knowledge,
    };
}

const search = (fixture: Fixture, input: unknown, options: Parameters<typeof knowledgeTools>[0] = { collections: ['handbook'] }) => callTool<KnowledgeSearchResult>(
    knowledgeTools(options),
    'knowledge_search',
    input,
    toolContext(fixture.knowledge),
);

async function vectorOf(model: MockEmbeddingModel, text: string): Promise<number[]> {
    return (await embed({ model, value: text })).embedding;
}

describe('knowledge_search', () => {
    it('ranks the matches by meaning, with their origin', async () => {
        const fixture = await setup();
        const result = await search(fixture, { query: 'refund policy' });

        expect(result.truncated).toBe(false);
        expect(result.matches).toHaveLength(3);
        expect(result.matches[0]).toEqual({
            collection: 'handbook',
            document: 'refunds',
            index: 0,
            text: HANDBOOK.refunds,
            score: expect.any(Number),
            title: 'Handbook: refunds',
            source: 'handbook/refunds.md',
        });

        const scores = result.matches.map((match) => match.score);

        expect(scores).toEqual([...scores].sort((a, b) => b - a));
        expect(scores[0]).toBeGreaterThan(scores[1]!);
    });

    it('honours topK from the options and the input, and minScore', async () => {
        const fixture = await setup();

        expect((await search(fixture, { query: 'refund policy', topK: 1 })).matches).toHaveLength(1);
        expect((await search(fixture, { query: 'refund policy' }, { collections: ['handbook'], topK: 2 })).matches).toHaveLength(2);

        const strict = await search(fixture, { query: 'Our refund policy: a refund is paid within 30 days.' }, {
            collections: ['handbook'],
            minScore: 0.999,
        });

        expect(strict.matches.map((match) => match.document)).toEqual(['refunds']);
    });

    it('defaults to five matches', async () => {
        const fixture = await setup({ index: false });
        const vector = await vectorOf(fixture.model, 'refund');

        await seedCollection(fixture.repository, 'many', fixture.model, {
            model: MODEL,
            documents: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`d${i}`, [{ text: `refund ${i}`, vector }]])),
        });

        const result = await search(fixture, { query: 'refund' }, { collections: ['many'] });

        expect(KNOWLEDGE_SEARCH_DEFAULT_RESULTS).toBe(5);
        expect(result.matches).toHaveLength(5);
        // equal scores: by document id
        expect(result.matches.map((match) => match.document)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4']);
    });

    it('merges several collections by score', async () => {
        const fixture = await setup({ index: false });

        await seedCollection(fixture.repository, 'alpha', fixture.model, {
            model: MODEL,
            documents: { returns: [{ text: 'refund policy for returns of damaged parcels' }] },
        });
        await seedCollection(fixture.repository, 'beta', fixture.model, {
            model: MODEL,
            documents: {
                exact: [{ text: 'refund policy' }],
                other: [{ text: 'kubernetes pods' }],
            },
        });

        const result = await search(fixture, { query: 'refund policy', topK: 3 }, { collections: ['alpha', 'beta'] });

        expect(result.matches.map((match) => [match.collection, match.document])).toEqual([
            ['beta', 'exact'],
            ['alpha', 'returns'],
            ['beta', 'other'],
        ]);

        const only = await search(fixture, { query: 'refund policy', collection: 'alpha' }, { collections: ['alpha', 'beta'] });

        expect(only.matches.map((match) => match.collection)).toEqual(['alpha']);
    });

    it('embeds the query once per distinct model', async () => {
        const fixture = await setup({ index: false });

        await seedCollection(fixture.repository, 'alpha', fixture.model, { model: MODEL, documents: { a: [{ text: 'refund' }] } });
        await seedCollection(fixture.repository, 'beta', fixture.model, { model: MODEL, documents: { b: [{ text: 'refund' }] } });

        const before = fixture.model.calls.length;

        await search(fixture, { query: 'refund' }, { collections: ['alpha', 'beta'] });

        expect(fixture.model.calls.length - before).toBe(1);
    });

    it('cuts the result at whole matches past the character cap', async () => {
        const fixture = await setup({ index: false });
        const vector = await vectorOf(fixture.model, 'refund');
        const text = 'r'.repeat(2000);

        await seedCollection(fixture.repository, 'large', fixture.model, {
            model: MODEL,
            documents: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`d${String(i).padStart(2, '0')}`, [{ text, vector }]])),
        });

        const result = await search(fixture, { query: 'refund', topK: 20 }, { collections: ['large'] });
        const total = result.matches.reduce((sum, match) => sum + match.text.length, 0);

        expect(KNOWLEDGE_SEARCH_MAX_CHARS).toBe(20_000);
        expect(result.truncated).toBe(true);
        expect(total).toBeLessThanOrEqual(KNOWLEDGE_SEARCH_MAX_CHARS);
        expect(result.matches).toHaveLength(10);
        expect(result.matches.every((match) => match.text === text)).toBe(true);
    });

    it('answers "not ready" for a collection never indexed, never empty matches', async () => {
        const fixture = await setup({ index: false });

        await expect(search(fixture, { query: 'refund' })).rejects.toThrow(ValidationError);
        await expect(search(fixture, { query: 'refund' })).rejects.toThrow('Knowledge collection "handbook" is not ready.');

        await seedCollection(fixture.repository, 'fresh', fixture.model, {
            model: MODEL,
            generation: 0,
            status: 'pending',
            documents: {},
        });
        await expect(search(fixture, { query: 'refund' }, { collections: ['fresh'] }))
            .rejects.toThrow('Knowledge collection "fresh" is not ready.');
        expect(fixture.model.calls).toHaveLength(0);
    });

    it('searches a stale collection at its served generation', async () => {
        const fixture = await setup({ index: false });

        await seedCollection(fixture.repository, 'old', fixture.model, {
            model: MODEL,
            status: 'stale',
            documents: { a: [{ text: 'refund' }] },
        });

        expect((await search(fixture, { query: 'refund' }, { collections: ['old'] })).matches).toHaveLength(1);
    });

    it('refuses a collection the agent did not name without searching it', async () => {
        const fixture = await setup();
        const spy = vi.spyOn(fixture.repository, 'search');
        const before = fixture.model.calls.length;

        await expect(search(fixture, { query: 'refund', collection: 'secrets' })).rejects.toThrow(ValidationError);
        await expect(search(fixture, { query: 'refund', collection: 'secrets' }))
            .rejects.toThrow('Knowledge collection "secrets" is not searchable here; search one of: handbook.');
        expect(spy).not.toHaveBeenCalled();
        expect(fixture.model.calls.length).toBe(before);
    });

    it('refuses an orphaned collection, and a declared one without a definition', async () => {
        const fixture = await setup();

        await seedCollection(fixture.repository, 'gone', fixture.model, {
            kind: 'declared',
            status: 'orphaned',
            model: MODEL,
            documents: { a: [{ text: 'refund' }] },
        });
        await seedCollection(fixture.repository, 'undeclared', fixture.model, {
            kind: 'declared',
            model: MODEL,
            documents: { a: [{ text: 'refund' }] },
        });

        const spy = vi.spyOn(fixture.repository, 'search');

        await expect(search(fixture, { query: 'refund' }, { collections: ['gone'] }))
            .rejects.toThrow('Knowledge collection "gone" is not available.');
        await expect(search(fixture, { query: 'refund' }, { collections: ['handbook', 'undeclared'] }))
            .rejects.toThrow('Knowledge collection "undeclared" is not available.');
        expect(spy).not.toHaveBeenCalled();
    });

    it('serves an orphaned record of a name this app declares (a replica that never declared it marked it)', async () => {
        const fixture = await setup({ index: false });

        await seedCollection(fixture.repository, 'handbook', fixture.model, {
            kind: 'declared',
            status: 'orphaned',
            trusted: true,
            model: MODEL,
            documents: { a: [{ text: 'refund' }] },
        });

        expect((await search(fixture, { query: 'refund' })).matches).toHaveLength(1);
    });

    it('answers a clear error while a re-embed runs and the served model is gone', async () => {
        const fixture = await setup({ index: false });

        // served by a model this process neither declares nor resolves
        await seedCollection(fixture.repository, 'handbook', fixture.model, {
            kind: 'declared',
            trusted: true,
            status: 'stale',
            model: 'retired/embed',
            documents: { a: [{ text: 'refund' }] },
        });

        await expect(search(fixture, { query: 'refund' })).rejects.toThrow(ValidationError);
        await expect(search(fixture, { query: 'refund' })).rejects.toThrow(
            'Knowledge collection "handbook" is being re-embedded; its previous model "retired/embed" is not available here, ' +
            'so it cannot be searched until the re-embed finishes.',
        );
    });

    it('answers a clear error for a collection whose model is not available', async () => {
        const fixture = await setup({ index: false });

        await seedCollection(fixture.repository, 'notes', fixture.model, { model: 'retired/embed', documents: { a: [{ text: 'refund' }] } });

        await expect(search(fixture, { query: 'refund' }, { collections: ['notes'] })).rejects.toThrow(new ValidationError(
            'Knowledge collection "notes": its embedding model "retired/embed" is not available here.',
        ));
    });

    it.each([
        [{}, 'query'],
        [{ query: '' }, 'query'],
        [{ query: ' '.repeat(3) }, 'query'],
        [{ query: 'x'.repeat(KNOWLEDGE_QUERY_MAX_LENGTH + 1) }, 'query'],
        [{ query: 'refund', topK: 0 }, 'topK'],
        [{ query: 'refund', topK: KNOWLEDGE_SEARCH_MAX_RESULTS + 1 }, 'topK'],
        [{ query: 'refund', topK: 1.5 }, 'topK'],
        [{ query: 'refund', collection: 3 }, 'collection'],
        ['refund', 'input'],
    ])('refuses the input %j', async (input, name) => {
        const fixture = await setup({ index: false });

        await expect(search(fixture, input)).rejects.toThrow(ValidationError);
        await expect(search(fixture, input)).rejects.toThrow(name);
    });

    it('tells the model the results are reference material, not instructions', () => {
        const tools = knowledgeTools({ collections: ['handbook', 'faq'] });
        const { description } = tools.knowledge_search!;

        expect(Object.keys(tools)).toEqual(['knowledge_search']);
        expect(description).toContain('not instructions');
        expect(description).toContain('handbook, faq');
    });

    it('taints a call that searches an untrusted or missing collection', async () => {
        const fixture = await setup();

        await seedCollection(fixture.repository, 'wiki', fixture.model, { model: MODEL, documents: {} });

        const tools = knowledgeTools({ collections: ['handbook', 'wiki', 'missing'] });
        const { taint } = (tools.knowledge_search as unknown as { trust: { taint: (input: unknown, ctx: unknown) => Promise<boolean> } }).trust;
        const ctx = toolContext(fixture.knowledge);

        expect(await taint({ query: 'x', collection: 'handbook' }, ctx)).toBe(false);
        expect(await taint({ query: 'x', collection: 'wiki' }, ctx)).toBe(true);
        expect(await taint({ query: 'x', collection: 'missing' }, ctx)).toBe(true);
        expect(await taint({ query: 'x' }, ctx)).toBe(true);
        // nothing is searched
        expect(await taint({ query: 'x', collection: 'other' }, ctx)).toBe(false);
    });

    it('leaves a declared trusted collection without a record untainted', async () => {
        const fixture = await setup({ index: false });
        const tools = knowledgeTools({ collections: ['handbook'] });
        const { taint } = (tools.knowledge_search as unknown as { trust: { taint: (input: unknown, ctx: unknown) => Promise<boolean> } }).trust;

        expect(await taint({ query: 'x' }, toolContext(fixture.knowledge))).toBe(false);
    });
});

describe('knowledgeTools() options', () => {
    it.each([
        [undefined, 'options'],
        [{}, 'collections'],
        [{ collections: [] }, 'collections'],
        [{ collections: ['Bad'] }, 'Bad'],
        [{ collections: ['docs', 'docs'] }, 'twice'],
        [{ collections: ['docs'], topK: 0 }, 'topK'],
        [{ collections: ['docs'], topK: KNOWLEDGE_SEARCH_MAX_RESULTS + 1 }, 'topK'],
        [{ collections: ['docs'], topK: 2.5 }, 'topK'],
        [{ collections: ['docs'], minScore: NaN }, 'minScore'],
        [{ collections: ['docs'], minScore: 2 }, 'minScore'],
    ])('refuses %j', (options, message) => {
        expect(() => knowledgeTools(options as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeTools(options as never)).toThrow(message);
    });
});

describe('the knowledge context', () => {
    it('needs a provided knowledge', async () => {
        const fixture = await setup({ index: false });
        const tools = knowledgeTools({ collections: ['handbook'] });

        await expect(callTool(tools, 'knowledge_search', { query: 'refund' }, toolContext()))
            .rejects.toThrow(ContextNotProvidedError);
        expect(() => injectKnowledgeContext(toolContext())).toThrow('knowledge');
        expect(injectKnowledgeContext(toolContext(fixture.knowledge))).toBe(fixture.knowledge);
    });

    it('is provided once per engine', async () => {
        const fixture = await setup({ index: false });
        const engine = new Engine({ store: createMemoryStore(), agents: [] });

        provideKnowledgeContext(engine, fixture.knowledge);
        expect(() => provideKnowledgeContext(engine, fixture.knowledge)).toThrow(InvalidAgentDefinitionError);
    });
});
