/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Engine,
    InvalidAgentDefinitionError,
    MemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { Agent } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { customProvider, streamText } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    BUILTIN_PROVIDERS,
    createModelRegistry,
    installDefaultProvider,
    resolveModels,
} from '@chamvi/app';
import type { ModelProviders } from '@chamvi/app';
import { textModel } from '../../utils/model.ts';

function agentWith(model: Agent['definition']['model'], name = 'triage'): Agent {
    return defineAgent({
        name,
        model,
        instructions: 'triage',
    });
}

function notFound(specifier: string): Error {
    const error = new Error(`Cannot find package '${specifier}' imported from /app/node_modules/@chamvi/app/dist/index.mjs`);
    (error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';
    return error;
}

/** An importer that knows only `@ai-sdk/anthropic` (as a fake) and records the factory options. */
function fakeImporter(model = textModel('from anthropic')) {
    const options: Array<Record<string, unknown>> = [];
    const importer = async (specifier: string): Promise<unknown> => {
        if (specifier === '@ai-sdk/anthropic') {
            return {
                createAnthropic: (input: Record<string, unknown>) => {
                    options.push(input);
                    return customProvider({ languageModels: { m: model } });
                },
            };
        }
        throw notFound(specifier);
    };
    return {
        importer,
        options,
        model,
    };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

afterEach(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
});

describe('createModelRegistry', () => {
    it('lists the five built-in providers', () => {
        expect(BUILTIN_PROVIDERS.map((p) => p.id)).toEqual(['anthropic', 'openai', 'google', 'mistral', 'xai']);
    });

    it('resolves \'anthropic/m\' through the discovered provider', async () => {
        const {
            importer,
            options,
            model,
        } = fakeImporter();
        const registry = await createModelRegistry({
            agents: [agentWith('anthropic/m')],
            env: { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: 'https://proxy.example/v1' },
            importer,
        });

        expect(registry.languageModel('anthropic/m')).toBe(model);
        expect(options).toEqual([{ apiKey: 'sk-test', baseURL: 'https://proxy.example/v1' }]);
    });

    it('omits unset keys from the factory options', async () => {
        const { importer, options } = fakeImporter();
        await createModelRegistry({
            agents: [],
            env: { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: '' },
            importer,
        });

        expect(options).toEqual([{ apiKey: 'sk-test' }]);
    });

    it('models override a discovered provider', async () => {
        const { importer } = fakeImporter();
        const other = textModel('from other');
        const registry = await createModelRegistry({
            agents: [agentWith('anthropic/m')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            models: { anthropic: customProvider({ languageModels: { m: other } }) },
            importer,
        });

        expect(registry.languageModel('anthropic/m')).toBe(other);
    });

    it('a missing package names it', async () => {
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('anthropic/m')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            importer: async (specifier) => {
                throw notFound(specifier);
            },
        }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('Agent "triage"');
        expect(error.message).toContain('install @ai-sdk/anthropic');
    });

    it('a broken transitive import rethrows', async () => {
        const broken = notFound('@ai-sdk/provider-utils');
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('anthropic/m')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            importer: async (specifier) => {
                if (specifier === '@ai-sdk/anthropic') throw broken;
                throw notFound(specifier);
            },
        }));

        expect(error).toBe(broken);
    });

    it('another import failure rethrows', async () => {
        const broken = new SyntaxError('Unexpected token');
        const error = await rejectionOf(createModelRegistry({
            agents: [],
            env: {},
            importer: async (specifier) => {
                if (specifier === '@ai-sdk/openai') throw broken;
                throw notFound(specifier);
            },
        }));

        expect(error).toBe(broken);
    });

    it('a missing key names the variable', async () => {
        const { importer } = fakeImporter();
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('anthropic/m')],
            env: { ANTHROPIC_API_KEY: '' },
            importer,
        }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('set ANTHROPIC_API_KEY');
    });

    it('a key is not needed for a provider in models', async () => {
        const model = textModel();
        const registry = await createModelRegistry({
            agents: [agentWith('anthropic/m')],
            env: {},
            models: { anthropic: customProvider({ languageModels: { m: model } }) },
            importer: async (specifier) => {
                throw notFound(specifier);
            },
        });

        expect(registry.languageModel('anthropic/m')).toBe(model);
    });

    it('a string without \'/\' throws', async () => {
        const { importer } = fakeImporter();
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('claude-sonnet')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            importer,
        }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('Agent "triage": model "claude-sonnet" must be "<provider>/<model>".');
    });

    it('a \'<provider>:<model>\' string throws, naming the string to write', async () => {
        const { importer } = fakeImporter();
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('anthropic:claude-sonnet')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            importer,
        }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('Agent "triage": model "anthropic:claude-sonnet" must be "<provider>/<model>" (anthropic/claude-sonnet).');
    });

    it('splits at the first \'/\', so a model id may hold one', async () => {
        const { importer } = fakeImporter();
        const model = textModel();
        const { registry } = await resolveModels({
            agents: [agentWith('router/meta-llama/llama-3')],
            env: {},
            models: { router: customProvider({ languageModels: { 'meta-llama/llama-3': model } }) },
            importer,
        });

        expect(registry.languageModel('router/meta-llama/llama-3')).toBe(model);
    });

    it('an unknown provider lists the available ones', async () => {
        const { importer } = fakeImporter();
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('acme/m')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            models: { local: customProvider({ languageModels: { m: textModel() } }) },
            importer,
        }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('"acme"');
        expect(error.message).toContain('anthropic, local');
    });

    it('resolveModels checks agents registered later with the same rules', async () => {
        const { importer } = fakeImporter();
        const { registry, check } = await resolveModels({
            agents: [],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            importer,
        });

        expect(registry.languageModel('anthropic/m')).toBeDefined();
        expect(() => check(agentWith('anthropic/m', 'later'))).not.toThrow();
        expect(() => check(agentWith(textModel(), 'later'))).not.toThrow();
        expect(() => check(agentWith('acme/m', 'later'))).toThrow(
            new InvalidAgentDefinitionError('Agent "later": model "acme/m" names the unknown provider "acme"; available: anthropic.'),
        );
    });

    it('non-string models are skipped', async () => {
        const registry = await createModelRegistry({
            agents: [agentWith(textModel())],
            env: {},
            importer: async (specifier) => {
                throw notFound(specifier);
            },
        });

        expect(registry).toBeDefined();
    });

    it('real @ai-sdk/anthropic exports createAnthropic', async () => {
        const registry = await createModelRegistry({
            agents: [agentWith('anthropic/claude-sonnet-5-5')],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
        });

        const model = registry.languageModel('anthropic/claude-sonnet-5-5');
        expect(model.provider).toContain('anthropic');
        expect(model.modelId).toBe('claude-sonnet-5-5');
    });

    it('the default importer reads an uninstalled provider as not installed', async () => {
        // @ai-sdk/openai is no devDependency of @chamvi/app
        const error = await rejectionOf(createModelRegistry({
            agents: [agentWith('openai/gpt-5')],
            env: { OPENAI_API_KEY: 'sk-test' },
        }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('install @ai-sdk/openai');
    });
});

describe('installDefaultProvider', () => {
    function registryOf(providers: ModelProviders) {
        return createModelRegistry({
            agents: [],
            env: {},
            models: providers,
            importer: async (specifier) => {
                throw notFound(specifier);
            },
        });
    }

    it('sets and restores the global', async () => {
        const registry = await registryOf({ local: customProvider({ languageModels: { m: textModel() } }) });
        const restore = installDefaultProvider(registry);

        expect(globalThis.AI_SDK_DEFAULT_PROVIDER?.languageModel('local/m')).toBe(registry.languageModel('local/m'));
        restore();
        expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBeUndefined();
    });

    it('resolves V4 string models without legacy compatibility conversion', async () => {
        const model = textModel('native V4');
        const registry = await registryOf({ local: customProvider({ languageModels: { m: model } }) });
        const restore = installDefaultProvider(registry);
        try {
            expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toMatchObject({ specificationVersion: 'v4' });
            expect(globalThis.AI_SDK_DEFAULT_PROVIDER?.languageModel('local/m')).toBe(model);
            const result = streamText({ model: 'local/m', prompt: 'hello' });
            expect(await result.text).toBe('native V4');
            expect(await result.warnings).toEqual([]);
        } finally {
            restore();
        }
    });

    it('keeps a global set by the user', async () => {
        const user = customProvider({ languageModels: { m: textModel() } });
        globalThis.AI_SDK_DEFAULT_PROVIDER = user;

        const registry = await registryOf({});
        const restore = installDefaultProvider(registry);
        expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(user);
        restore();
        expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(user);
    });

    it('restore leaves a global replaced meanwhile', async () => {
        const registry = await registryOf({});
        const restore = installDefaultProvider(registry);
        const replaced = customProvider({ languageModels: { m: textModel() } });
        globalThis.AI_SDK_DEFAULT_PROVIDER = replaced;

        restore();
        expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(replaced);
    });

    it('never the Gateway', async () => {
        const { importer, model } = fakeImporter(textModel('triaged'));
        const agent = agentWith('anthropic/m');
        const registry = await createModelRegistry({
            agents: [agent],
            env: { ANTHROPIC_API_KEY: 'sk-test' },
            importer,
        });
        const restore = installDefaultProvider(registry);

        const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
        const engine = new Engine({
            store: new MemoryStore({ clock }),
            agents: [agent],
            clock,
        });
        try {
            await engine.start();
            const { runId } = await engine.dispatch({
                agent: 'triage',
                trigger: 'http',
                channel: 'http',
                payload: {},
            });
            await engine.idle();

            const run = await engine.getRun(runId);
            expect(run?.status).toBe('completed');
            expect(run?.output).toBe('triaged');
            expect(model.doStreamCalls).toHaveLength(1);
        } finally {
            await engine.drain({ timeoutMs: 0 });
            restore();
        }
    });
});
