/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createProviderRegistry } from 'ai';
import { isObject } from 'smob';
import { BUILTIN_PROVIDERS, MODEL_SEPARATOR } from './constants.ts';
import { envString } from '../env/module.ts';
import { defaultImporter, isPackageNotFound } from './helpers.ts';
import type {
    BuiltinProvider,
    ModelCheck,
    ModelProviders,
    ModelRegistry,
    ModelRegistryOptions,
    ResolvedModels,
} from './types.ts';

type Discovered = {
    provider: BuiltinProvider;
    /** The built provider; undefined while the package is not installed. */
    instance?: ModelProviders[string];
};

async function discover(
    provider: BuiltinProvider,
    options: ModelRegistryOptions,
    importer: (specifier: string) => Promise<unknown>,
): Promise<Discovered> {
    let exports: unknown;
    try {
        exports = await importer(provider.package);
    } catch (error) {
        if (isPackageNotFound(error, provider.package)) {
            return { provider };
        }
        throw error;
    }

    const factory = isObject(exports) ? exports[provider.factory] : undefined;
    if (typeof factory !== 'function') {
        throw new InvalidAgentDefinitionError(`${provider.package} does not export ${provider.factory}().`);
    }

    const settings: Record<string, string> = {};
    const apiKey = envString(options.env, provider.apiKey);
    if (apiKey !== undefined) {
        settings.apiKey = apiKey;
    }
    const baseURL = provider.baseUrl ? envString(options.env, provider.baseUrl) : undefined;
    if (baseURL !== undefined) {
        settings.baseURL = baseURL;
    }

    return { provider, instance: factory(settings) as ModelProviders[string] };
}

function hasOwn(record: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function checkModel(
    agent: string,
    model: string,
    providers: ModelProviders,
    options: ModelRegistryOptions,
    discovered: readonly Discovered[],
): void {
    const index = model.indexOf(MODEL_SEPARATOR);
    if (index <= 0 || index === model.length - 1) {
        // the AI SDK registry's default separator; name the string to write instead
        const colon = model.indexOf(':');
        const hint = colon > 0 && colon < model.length - 1 ?
            ` (${model.slice(0, colon)}${MODEL_SEPARATOR}${model.slice(colon + 1)})` :
            '';
        throw new InvalidAgentDefinitionError(`Agent "${agent}": model "${model}" must be "<provider>/<model>"${hint}.`);
    }

    const id = model.slice(0, index);
    if (options.models && hasOwn(options.models, id)) {
        return;
    }

    const builtin = discovered.find((entry) => entry.provider.id === id);
    if (builtin) {
        if (!builtin.instance) {
            throw new InvalidAgentDefinitionError(
                `Agent "${agent}": model "${model}" needs the ${id} provider; install ${builtin.provider.package}.`,
            );
        }
        if (envString(options.env, builtin.provider.apiKey) === undefined) {
            throw new InvalidAgentDefinitionError(
                `Agent "${agent}": model "${model}" needs an API key; set ${builtin.provider.apiKey}.`,
            );
        }
        return;
    }

    const available = Object.keys(providers).sort();
    const list = available.length > 0 ? available.join(', ') : 'none (install a provider package or pass models)';
    throw new InvalidAgentDefinitionError(
        `Agent "${agent}": model "${model}" names the unknown provider "${id}"; available: ${list}.`,
    );
}

/**
 * The provider registry model strings resolve through (every installed
 * built-in provider, keys and base URLs from \`env\`, overridden by
 * \`models\`) and the check of one agent against it, run for every agent of
 * \`agents\` here and reusable for agents registered later: a model string
 * never falls through to the Vercel Gateway, InvalidAgentDefinitionError names
 * the package to install or the variable to set.
 */
export async function resolveModels(options: ModelRegistryOptions): Promise<ResolvedModels> {
    const importer = options.importer ?? defaultImporter;
    const discovered = await Promise.all(BUILTIN_PROVIDERS.map((provider) => discover(provider, options, importer)));

    const providers: ModelProviders = {};
    for (const entry of discovered) {
        if (entry.instance) {
            providers[entry.provider.id] = entry.instance;
        }
    }
    Object.assign(providers, options.models);

    const check: ModelCheck = (agent) => {
        const { model } = agent.definition;
        if (typeof model === 'string') {
            checkModel(agent.name, model, providers, options, discovered);
        }
    };
    options.agents.forEach(check);

    return { registry: createProviderRegistry(providers, { separator: MODEL_SEPARATOR }), check };
}

/**
 * Builds the provider registry model strings resolve through, after checking
 * every agent's string model against it (see \`resolveModels\`).
 */
export async function createModelRegistry(options: ModelRegistryOptions): Promise<ModelRegistry> {
    return (await resolveModels(options)).registry;
}

/**
 * Sets the registry as \`globalThis.AI_SDK_DEFAULT_PROVIDER\` while none is
 * set. The returned restore unsets it again, but only while it still is this
 * registry; with a provider set before, nothing changes and restore is a no-op.
 */
export function installDefaultProvider(registry: ModelRegistry): () => void {
    type DefaultProvider = NonNullable<typeof globalThis.AI_SDK_DEFAULT_PROVIDER>;
    if (globalThis.AI_SDK_DEFAULT_PROVIDER !== undefined) {
        return () => undefined;
    }

    // Registry methods already return V4 models. Without this provider contract
    // marker the SDK treats the registry as V2 and converts those models again.
    const installed = {
        specificationVersion: 'v4' as const,
        languageModel: (id: string) => registry.languageModel(id as `${string}/${string}`),
        embeddingModel: (id: string) => registry.embeddingModel(id as `${string}/${string}`),
        imageModel: (id: string) => registry.imageModel(id as `${string}/${string}`),
        transcriptionModel: (id: string) => registry.transcriptionModel(id as `${string}/${string}`),
        speechModel: (id: string) => registry.speechModel(id as `${string}/${string}`),
        rerankingModel: (id: string) => registry.rerankingModel(id as `${string}/${string}`),
    } satisfies DefaultProvider;
    globalThis.AI_SDK_DEFAULT_PROVIDER = installed;

    return () => {
        if (globalThis.AI_SDK_DEFAULT_PROVIDER === installed) {
            globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
        }
    };
}
