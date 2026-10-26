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
import { customProvider } from 'ai';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { createModelResolver } from '../../../src/models/resolver.ts';
import { readModelSettings } from '../../../src/models/settings.ts';
import type { ModelSettings, ProviderConfig } from '../../../src/models/types.ts';
import { textModel } from '../../utils/model.ts';

function notFound(specifier: string): Error {
    const error = new Error(`Cannot find package '${specifier}' imported from /app/node_modules/@chamvi/app/dist/index.mjs`);
    (error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';
    return error;
}

type Call = {
    specifier: string;
    factory: string;
    input: Record<string, unknown>
};

/**
 * An importer that knows the given packages; every factory records its input
 * and returns a customProvider over `models`.
 */
function fakeImporter(packages: Record<string, string>, models: Record<string, ReturnType<typeof textModel>> = { m: textModel() }) {
    const calls: Call[] = [];
    const imported: string[] = [];
    const importer = async (specifier: string): Promise<unknown> => {
        imported.push(specifier);
        const factory = packages[specifier];
        if (!factory) {
            throw notFound(specifier);
        }
        return {
            [factory]: (input: Record<string, unknown>) => {
                calls.push({
                    specifier,
                    factory,
                    input,
                });
                return customProvider({ languageModels: models });
            },
        };
    };
    return {
        importer,
        calls,
        imported,
    };
}

function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a throw');
}

describe('createModelResolver', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'chamvi-resolver-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    async function settingsOf(input: {
        env?: Record<string, string | undefined>;
        model?: string;
        providers?: Record<string, ProviderConfig>;
    } = {}): Promise<ModelSettings> {
        const { settings, issues } = await readModelSettings({
            env: input.env ?? {},
            cwd,
            model: input.model,
            providers: input.providers,
        });
        expect(issues).toEqual([]);
        return settings;
    }

    it('calls a factory once with exactly apiKey, the default base URL and headers', async () => {
        const fake = fakeImporter({ '@ai-sdk/anthropic': 'createAnthropic' });
        const resolver = await createModelResolver(
            await settingsOf({ env: { ANTHROPIC_API_KEY: 'k' } }),
            { importer: fake.importer },
        );

        resolver.check('anthropic/m', 'triage');
        resolver.resolve('anthropic/m');
        resolver.resolve('anthropic/m');

        expect(fake.calls).toEqual([{
            specifier: '@ai-sdk/anthropic',
            factory: 'createAnthropic',
            input: {
                apiKey: 'k',
                baseURL: 'https://api.anthropic.com/v1',
                headers: {},
            },
        }]);
        expect(resolver.errors.size).toBe(0);
    });

    it('passes a set base URL and the headers', async () => {
        const fake = fakeImporter({ '@ai-sdk/anthropic': 'createAnthropic' });
        await createModelResolver(
            await settingsOf({
                providers: {
                    'team-a': {
                        type: 'anthropic',
                        apiKey: 'k',
                        baseURL: 'https://proxy.example.com/v1',
                        headers: { 'x-team': 'a' },
                    },
                },
            }),
            { importer: fake.importer },
        );

        expect(fake.calls.map((call) => call.input)).toEqual([
            {
                apiKey: 'k',
                baseURL: 'https://proxy.example.com/v1',
                headers: { 'x-team': 'a' },
            },
        ]);
    });

    it('builds one instance per provider name, importing a package once', async () => {
        const fake = fakeImporter({ '@ai-sdk/anthropic': 'createAnthropic' });
        const resolver = await createModelResolver(
            await settingsOf({
                providers: {
                    'team-a': { type: 'anthropic', apiKey: 'a' },
                    'team-b': { type: 'anthropic', apiKey: 'b' },
                },
            }),
            { importer: fake.importer },
        );

        expect(fake.imported).toEqual(['@ai-sdk/anthropic']);
        expect(fake.calls.map((call) => call.input.apiKey)).toEqual(['a', 'b']);
        expect(resolver.resolve('team-a/m')).toBeDefined();
        expect(resolver.resolve('team-b/m')).toBeDefined();
    });

    it('reads no bare variable from process.env', async () => {
        const previous = process.env.ANTHROPIC_API_KEY;
        process.env.ANTHROPIC_API_KEY = 'from-process';
        try {
            const fake = fakeImporter({ '@ai-sdk/anthropic': 'createAnthropic' });
            const resolver = await createModelResolver(await settingsOf(), { importer: fake.importer });

            const error = errorOf(() => resolver.check('anthropic/m', 'triage'));
            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect(error.message).toBe(
                'Agent "triage" uses provider "anthropic", which is not configured. ' +
                'Set ANTHROPIC_API_KEY, or CHAMVI_PROVIDER_ANTHROPIC_TYPE and CHAMVI_PROVIDER_ANTHROPIC_API_KEY, ' +
                'or declare it in chamvi.json.',
            );
            expect(() => resolver.resolve('anthropic/m')).toThrow(InvalidAgentDefinitionError);
            expect(fake.calls).toEqual([]);
        } finally {
            if (previous === undefined) {
                delete process.env.ANTHROPIC_API_KEY;
            } else {
                process.env.ANTHROPIC_API_KEY = previous;
            }
        }
    });

    it('names the provider variables of a custom name and words the default model', async () => {
        const resolver = await createModelResolver(await settingsOf(), { importer: fakeImporter({}).importer });

        expect(errorOf(() => resolver.check('team-a/m', 'triage')).message).toBe(
            'Agent "triage" uses provider "team-a", which is not configured. ' +
            'Set CHAMVI_PROVIDER_TEAM_A_TYPE and CHAMVI_PROVIDER_TEAM_A_API_KEY, or declare it in chamvi.json.',
        );
        expect(errorOf(() => resolver.check('team-a/m')).message).toBe(
            'The default model "team-a/m" uses provider "team-a", which is not configured. ' +
            'Set CHAMVI_PROVIDER_TEAM_A_TYPE and CHAMVI_PROVIDER_TEAM_A_API_KEY, or declare it in chamvi.json.',
        );
    });

    it('gives a keyless openai-compatible provider its name, base URL and headers, without an apiKey key', async () => {
        const fake = fakeImporter(
            { '@ai-sdk/openai-compatible': 'createOpenAICompatible' },
            { 'cc/claude-opus-4-6': textModel() },
        );
        const resolver = await createModelResolver(
            await settingsOf({
                providers: {
                    router: {
                        type: 'openai-compatible',
                        baseURL: 'https://router.example.com/v1',
                        headers: { 'x-team': 'a' },
                    },
                },
            }),
            { importer: fake.importer },
        );

        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]?.input).toStrictEqual({
            name: 'router',
            baseURL: 'https://router.example.com/v1',
            headers: { 'x-team': 'a' },
        });
        expect(Object.keys(fake.calls[0]?.input ?? {})).not.toContain('apiKey');
        expect(resolver.errors.size).toBe(0);
    });

    it('passes the key of an openai-compatible provider that has one', async () => {
        const fake = fakeImporter({ '@ai-sdk/openai-compatible': 'createOpenAICompatible' });
        await createModelResolver(
            await settingsOf({
                providers: {
                    router: {
                        type: 'openai-compatible',
                        apiKey: 'k',
                        baseURL: 'https://router.example.com/v1',
                    },
                },
            }),
            { importer: fake.importer },
        );

        expect(fake.calls[0]?.input).toStrictEqual({
            name: 'router',
            apiKey: 'k',
            baseURL: 'https://router.example.com/v1',
            headers: {},
        });
    });

    it('resolves at the first slash', async () => {
        const model = textModel();
        const fake = fakeImporter(
            { '@ai-sdk/openai-compatible': 'createOpenAICompatible' },
            { 'cc/claude-opus-4-6': model },
        );
        const resolver = await createModelResolver(
            await settingsOf({ providers: { router: { type: 'openai-compatible', baseURL: 'https://router.example.com/v1' } } }),
            { importer: fake.importer },
        );

        resolver.check('router/cc/claude-opus-4-6', 'a');
        expect(resolver.resolve('router/cc/claude-opus-4-6')).toBe(model);
    });

    it('builds a gateway provider with createGateway from ai', async () => {
        const fake = fakeImporter({ ai: 'createGateway' });
        const resolver = await createModelResolver(
            await settingsOf({ providers: { gw: { type: 'gateway', apiKey: 'k' } } }),
            { importer: fake.importer },
        );

        expect(fake.calls).toEqual([{
            specifier: 'ai',
            factory: 'createGateway',
            input: {
                apiKey: 'k',
                baseURL: 'https://ai-gateway.vercel.sh/v4/ai',
                headers: {},
            },
        }]);
        expect(resolver.resolve('gw/m')).toBeDefined();
    });

    it('builds a real gateway provider through the default importer', async () => {
        const resolver = await createModelResolver(
            await settingsOf({ providers: { gw: { type: 'gateway', apiKey: 'k' } } }),
        );

        const model = resolver.resolve('gw/anthropic/claude-sonnet-5-5');
        expect(typeof model).toBe('object');
        expect((model as { modelId: string }).modelId).toBe('anthropic/claude-sonnet-5-5');
    });

    it('lets models win for its ids without importing the package', async () => {
        const model = textModel();
        const fake = fakeImporter({ '@ai-sdk/anthropic': 'createAnthropic' });
        const resolver = await createModelResolver(
            await settingsOf({ env: { ANTHROPIC_API_KEY: 'k' } }),
            {
                importer: fake.importer,
                models: { anthropic: customProvider({ languageModels: { m: model } }) },
            },
        );

        expect(fake.imported).toEqual([]);
        expect(fake.calls).toEqual([]);
        resolver.check('anthropic/m', 'a');
        expect(resolver.resolve('anthropic/m')).toBe(model);
    });

    it('resolves a models id no setting declares', async () => {
        const model = textModel();
        const resolver = await createModelResolver(await settingsOf(), {
            importer: fakeImporter({}).importer,
            models: { local: customProvider({ languageModels: { m: model } }) },
        });

        resolver.check('local/m', 'a');
        expect(resolver.resolve('local/m')).toBe(model);
    });

    it('records a missing package in errors and throws it from check and resolve', async () => {
        const fake = fakeImporter({});
        const resolver = await createModelResolver(
            await settingsOf({ providers: { router: { type: 'openai-compatible', baseURL: 'https://router.example.com/v1' } } }),
            { importer: fake.importer },
        );

        const message = 'Provider type "openai-compatible" needs package @ai-sdk/openai-compatible.';
        expect([...resolver.errors]).toEqual([['router', message]]);

        const error = errorOf(() => resolver.check('router/m', 'a'));
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe(message);
        expect(errorOf(() => resolver.resolve('router/m')).message).toBe(message);
    });

    it('refuses an installed package without the factory', async () => {
        const importer = async (): Promise<unknown> => ({ somethingElse: () => undefined });

        await expect(createModelResolver(
            await settingsOf({ env: { ANTHROPIC_API_KEY: 'k' } }),
            { importer },
        )).rejects.toThrow('@ai-sdk/anthropic does not export createAnthropic().');
    });

    it('rethrows an import failure other than a missing package', async () => {
        const failure = new Error('broken package');
        const importer = async (): Promise<unknown> => {
            throw failure;
        };

        await expect(createModelResolver(
            await settingsOf({ env: { ANTHROPIC_API_KEY: 'k' } }),
            { importer },
        )).rejects.toBe(failure);
    });

    it('refuses a ref without a provider and model, naming the slash form of a colon ref', async () => {
        const resolver = await createModelResolver(await settingsOf(), { importer: fakeImporter({}).importer });

        expect(errorOf(() => resolver.check('gpt', 'a')).message).toBe('Agent "a": model "gpt" must be "<provider>/<model>".');
        expect(errorOf(() => resolver.check('openai:gpt', 'a')).message)
            .toBe('Agent "a": model "openai:gpt" must be "<provider>/<model>" (openai/gpt).');
        expect(errorOf(() => resolver.check('/gpt', 'a')).message).toBe('Agent "a": model "/gpt" must be "<provider>/<model>".');
        expect(errorOf(() => resolver.check('openai/', 'a')).message).toBe('Agent "a": model "openai/" must be "<provider>/<model>".');
        expect(errorOf(() => resolver.check('gpt')).message).toBe('The default model "gpt" must be "<provider>/<model>".');
        expect(errorOf(() => resolver.resolve('gpt'))).toBeInstanceOf(InvalidAgentDefinitionError);
    });

    it('real @ai-sdk/anthropic exports createAnthropic', async () => {
        const resolver = await createModelResolver(await settingsOf({ env: { ANTHROPIC_API_KEY: 'sk-test' } }));

        const model = resolver.resolve('anthropic/claude-sonnet-5-5') as { provider: string; modelId: string };
        expect(model.provider).toContain('anthropic');
        expect(model.modelId).toBe('claude-sonnet-5-5');
    });

    it('the default importer reads an uninstalled provider as not installed', async () => {
        // @ai-sdk/openai is no devDependency of @chamvi/app
        const resolver = await createModelResolver(await settingsOf({ env: { OPENAI_API_KEY: 'sk-test' } }));

        const message = 'Provider type "openai" needs package @ai-sdk/openai.';
        expect(resolver.errors.get('openai')).toBe(message);
        expect(errorOf(() => resolver.check('openai/gpt-5', 'a')).message).toBe(message);
    });
});
