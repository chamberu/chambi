/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { NoSuchModelError, customProvider } from 'ai';
import { MockEmbeddingModelV4 } from 'ai/test';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { createModelResolver } from '../../../src/models/resolver.ts';
import { readModelSettings } from '../../../src/models/settings.ts';
import type { ModelSettings } from '../../../src/models/types.ts';

/**
 * An importer whose `@ai-sdk/openai` factory returns a provider that records
 * every `embeddingModel` call; an id outside `known` throws NoSuchModelError,
 * as the AI SDK's providers do.
 */
function embeddingImporter(known: Record<string, MockEmbeddingModelV4>) {
    const calls: string[] = [];
    const importer = async (specifier: string): Promise<unknown> => {
        if (specifier !== '@ai-sdk/openai') {
            const error = new Error(`Cannot find package '${specifier}'`);

            (error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';

            throw error;
        }

        return {
            createOpenAI: () => ({
                languageModel: (modelId: string) => {
                    throw new NoSuchModelError({ modelId, modelType: 'languageModel' });
                },
                embeddingModel: (modelId: string) => {
                    calls.push(modelId);

                    const model = known[modelId];

                    if (!model) {
                        throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
                    }

                    return model;
                },
            }),
        };
    };

    return { importer, calls };
}

function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }

    throw new Error('expected a throw');
}

describe('createModelResolver: embedding()', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'chamvi-resolver-embedding-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    async function settingsOf(env: Record<string, string | undefined>): Promise<ModelSettings> {
        const { settings, issues } = await readModelSettings({ env, cwd });

        expect(issues).toEqual([]);

        return settings;
    }

    it('returns the provider\'s embeddingModel(id)', async () => {
        const small = new MockEmbeddingModelV4();
        const fake = embeddingImporter({ 'text-embedding-3-small': small });
        const resolver = await createModelResolver(
            await settingsOf({ OPENAI_API_KEY: 'k' }),
            { importer: fake.importer },
        );

        expect(resolver.embedding('openai/text-embedding-3-small')).toBe(small);
        expect(fake.calls).toEqual(['text-embedding-3-small']);
    });

    it('refuses an unconfigured provider with the message resolve() throws', async () => {
        const fake = embeddingImporter({});
        const resolver = await createModelResolver(await settingsOf({}), { importer: fake.importer });

        const resolveError = errorOf(() => resolver.resolve('openai/m'));
        const embeddingError = errorOf(() => resolver.embedding('openai/m'));

        expect(embeddingError).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(embeddingError.message).toBe(resolveError.message);
        expect(embeddingError.message).toContain('uses provider "openai", which is not configured');
    });

    it('refuses a ref that is no "<provider>/<model>"', async () => {
        const resolver = await createModelResolver(await settingsOf({}), { importer: embeddingImporter({}).importer });

        const error = errorOf(() => resolver.embedding('text-embedding-3-small'));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('The model "text-embedding-3-small" must be "<provider>/<model>".');
    });

    it('wraps a provider that offers no such embedding model', async () => {
        const fake = embeddingImporter({});
        const resolver = await createModelResolver(
            await settingsOf({ OPENAI_API_KEY: 'k' }),
            { importer: fake.importer },
        );

        const error = errorOf(() => resolver.embedding('openai/nope'));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('Provider "openai" offers no embedding model "nope".');
    });

    it('lets createApp\'s models win for their ids', async () => {
        const configured = new MockEmbeddingModelV4();
        const overriding = new MockEmbeddingModelV4();
        const fake = embeddingImporter({ e: configured });
        const resolver = await createModelResolver(
            await settingsOf({ OPENAI_API_KEY: 'k' }),
            {
                importer: fake.importer,
                models: { openai: customProvider({ embeddingModels: { e: overriding } }) },
            },
        );

        expect(resolver.embedding('openai/e')).toBe(overriding);
        expect(fake.calls).toEqual([]);
    });
});
