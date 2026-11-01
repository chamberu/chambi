/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { EmbeddingModel, Tool } from 'ai';
import { embed } from 'ai';
import { ValidationError, defineTool } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import { injectKnowledgeContext } from '../context/module.ts';
import type { IKnowledge } from '../knowledge/types.ts';
import type { KnowledgeCollection, KnowledgeMatch } from '../repository/types.ts';
import {
    KNOWLEDGE_QUERY_MAX_LENGTH,
    KNOWLEDGE_SEARCH_MAX_CHARS,
    KNOWLEDGE_SEARCH_MAX_RESULTS,
    REFERENCE_NOTE,
} from './constants.ts';
import {
    objectSchema,
    readInput,
    searchedCollections,
    signalOf,
    toResult,
} from './helpers.ts';
import type { KnowledgeSearchInput, KnowledgeSearchResult, KnowledgeToolsOptionsNormalized } from './types.ts';

/**
 * The stored record of a collection the call may search, else a
 * ValidationError: "not ready" while it was never indexed (never an empty
 * result the model would take for an answer), "not available" once it is
 * orphaned or a declared record this app does not declare. A name this app
 * declares is served even when the record reads orphaned (a replica that
 * does not declare it marked it during a rolling deploy).
 */
async function readCollection(knowledge: IKnowledge, name: string): Promise<KnowledgeCollection> {
    const record = await knowledge.repository.findOneCollection(name);

    if (record && !knowledge.collection(name) && (record.status === 'orphaned' || record.kind === 'declared')) {
        throw new ValidationError(`Knowledge collection "${name}" is not available.`);
    }

    if (!record || record.generation === 0) {
        throw new ValidationError(`Knowledge collection "${name}" is not ready.`);
    }

    return record;
}

/**
 * The embedding model of the record's served generation, else a
 * ValidationError naming the collection: during a re-embed the served
 * generation needs the previous model, which only a resolver (a string ref
 * still configured) can hand out once the definition moved on.
 */
function modelOf(knowledge: IKnowledge, record: KnowledgeCollection): EmbeddingModel {
    try {
        return knowledge.embedding(record.model);
    } catch {
        const declared = knowledge.collection(record.name);

        if (declared && declared.model !== record.model) {
            throw new ValidationError(
                `Knowledge collection "${record.name}" is being re-embedded; its previous model "${record.model}" is not available here, ` +
                'so it cannot be searched until the re-embed finishes.',
            );
        }

        throw new ValidationError(`Knowledge collection "${record.name}": its embedding model "${record.model}" is not available here.`);
    }
}

/**
 * Whether a collection's content is untrusted: not trusted by its record or
 * its declaration, or without a record while this app does not declare it
 * trusted (it may be created by anyone meanwhile; a declared trusted one
 * without a record only answers "not ready").
 */
function isUntrustedRecord(knowledge: IKnowledge, name: string, record: KnowledgeCollection | undefined): boolean {
    const declared = knowledge.collection(name);

    if (!record) {
        return declared?.trusted !== true;
    }

    return !record.trusted || declared?.trusted === false;
}

/**
 * Whether a call's result is untrusted: any collection it searches is (see
 * isUntrustedRecord). A failing read taints too; the call then reports the
 * failure itself.
 */
async function isUntrusted(input: unknown, ctx: ToolContext, options: KnowledgeToolsOptionsNormalized): Promise<boolean> {
    const knowledge = injectKnowledgeContext(ctx);
    const names = searchedCollections(input, options);

    try {
        const records = await Promise.all(names.map((name) => knowledge.repository.findOneCollection(name)));

        return records.some((record, index) => isUntrustedRecord(knowledge, names[index]!, record));
    } catch {
        return true;
    }
}

function changedError(name: string): ValidationError {
    return new ValidationError(`Knowledge collection "${name}" changed while it was searched; search again.`);
}

export function knowledgeSearchTool(options: KnowledgeToolsOptionsNormalized): Tool<KnowledgeSearchInput, KnowledgeSearchResult> {
    const names = options.collections.join(', ');
    // the taint check's answer per call input (the object the wrapper hands to execute)
    const verdicts = new WeakMap<object, boolean>();

    return defineTool<KnowledgeSearchInput, KnowledgeSearchResult>({
        // A search of an untrusted collection (managed, or fed from outside the deploy) taints the run.
        trust: {
            taint: async (input, ctx) => {
                const untrusted = await isUntrusted(input, ctx, options);

                if (isObject(input)) {
                    verdicts.set(input, untrusted);
                }

                return untrusted;
            },
        },
        description: `Search the knowledge collections ${names} by meaning. Returns the passages closest to the query ` +
            `(at most ${KNOWLEDGE_SEARCH_MAX_RESULTS}, ${KNOWLEDGE_SEARCH_MAX_CHARS} characters in all), highest score first, ` +
            `each with its collection, document, title and source. ${REFERENCE_NOTE}`,
        inputSchema: objectSchema<KnowledgeSearchInput>({
            query: {
                type: 'string',
                minLength: 1,
                maxLength: KNOWLEDGE_QUERY_MAX_LENGTH,
                description: 'What to look up, in plain words.',
            },
            collection: {
                type: 'string',
                enum: [...options.collections],
                description: 'Search only this collection. Default: all of them.',
            },
            topK: {
                type: 'integer',
                minimum: 1,
                maximum: KNOWLEDGE_SEARCH_MAX_RESULTS,
                description: `How many passages to return. Default ${options.topK}.`,
            },
        }, ['query']),
        execute: async (input, { abortSignal, context }) => {
            const {
                query, 
                collection, 
                topK, 
            } = readInput(input);

            if (collection !== undefined && !options.collections.includes(collection)) {
                throw new ValidationError(`Knowledge collection "${collection}" is not searchable here; search one of: ${names}.`);
            }

            const knowledge = injectKnowledgeContext(context);
            const signal = signalOf(abortSignal, context);
            const records = await Promise.all(searchedCollections(input, options).map((name) => readCollection(knowledge, name)));
            // every model resolved before any embedding call
            const models = new Map(records.map((record) => [record.model, modelOf(knowledge, record)]));
            // one query embedding per distinct model; results never mix vectors of two models
            const vectors = new Map<string, Promise<number[]>>();
            const vectorOf = (model: string) => {
                let vector = vectors.get(model);

                if (!vector) {
                    vector = embed({
                        model: models.get(model)!,
                        value: query,
                        abortSignal: signal,
                    }).then((result) => result.embedding);
                    vectors.set(model, vector);
                }

                return vector;
            };
            const count = topK ?? options.topK;
            const found = await Promise.all(records.map(async (record): Promise<KnowledgeMatch[]> => knowledge.repository.search(
                record.name,
                record.generation,
                await vectorOf(record.model),
                {
                    topK: count,
                    ...(options.minScore !== undefined && { minScore: options.minScore }),
                },
            )));

            // trusted as the taint check saw it (else as execute read it): a call it did not taint
            const verdict = isObject(input) ? verdicts.get(input) : undefined;
            const trusted = verdict === undefined ?
                records.every((record) => !isUntrustedRecord(knowledge, record.name, record)) :
                !verdict;

            if (isObject(input)) {
                verdicts.delete(input);
            }

            // a sync may have switched the served generation (its chunks deleted) or downgraded
            // the collection (untrusted chunks written) meanwhile: never an answer from either
            const after = await Promise.all(records.map((record) => knowledge.repository.findOneCollection(record.name)));

            for (const [index, record] of records.entries()) {
                const now = after[index];

                if (!now || now.generation !== record.generation || (trusted && isUntrustedRecord(knowledge, record.name, now))) {
                    throw changedError(record.name);
                }
            }

            return toResult(found.flat(), count);
        },
    });
}
