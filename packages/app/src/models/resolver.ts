/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { LanguageModel } from 'ai';
import { isObject } from 'smob';
import { BUILTIN_PROVIDERS, MODEL_SEPARATOR, PROVIDER_TYPES } from './constants.ts';
import { defaultImporter, isPackageNotFound, providerEnvName } from './helpers.ts';
import type {
    ModelProviders,
    ModelResolver,
    ModelResolverOptions,
    ModelSettings,
    ProviderSettings,
} from './types.ts';

type Provider = ModelProviders[string];

type Factory = (input: Record<string, unknown>) => Provider;

/** The package's exports, or undefined when the package is not installed. */
type Loaded = { exports?: unknown };

function hasOwn(record: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

/** What a provider's factory gets: always an explicit base URL, so no factory reads process.env. */
function factoryInput(provider: ProviderSettings): Record<string, unknown> {
    const type = PROVIDER_TYPES[provider.type];
    const input: Record<string, unknown> = {};
    if (provider.type === 'openai-compatible') {
        input.name = provider.name;
    }
    if (typeof provider.apiKey !== 'undefined') {
        input.apiKey = provider.apiKey;
    }
    input.baseURL = provider.baseURL ?? type.defaultBaseURL;
    input.headers = { ...provider.headers };
    return input;
}

/**
 * The prefix of a message about `ref`: the agent's, the app's default model
 * (`check` without an agent), or a model a tool resolves (`resolve`, which
 * cannot tell an agent's model from one the tool named).
 */
type Subject = { kind: 'agent'; agent: string } | { kind: 'default' } | { kind: 'model' };

function subjectOf(ref: string, subject: Subject): string {
    if (subject.kind === 'agent') return `Agent "${subject.agent}"`;
    return subject.kind === 'default' ? `The default model "${ref}"` : `The model "${ref}"`;
}

function checkSubject(agent: string | undefined): Subject {
    return typeof agent === 'undefined' ? { kind: 'default' } : { kind: 'agent', agent };
}

function splitRef(ref: string, subject: Subject): { provider: string; modelId: string } {
    const index = ref.indexOf(MODEL_SEPARATOR);
    if (index <= 0 || index === ref.length - 1) {
        // the AI SDK registry's former default separator; name the string to write instead
        const colon = ref.indexOf(':');
        const hint = colon > 0 && colon < ref.length - 1 ?
            ` (${ref.slice(0, colon)}${MODEL_SEPARATOR}${ref.slice(colon + 1)})` :
            '';
        const prefix = subject.kind === 'agent' ? `${subjectOf(ref, subject)}: model "${ref}"` : subjectOf(ref, subject);
        throw new InvalidAgentDefinitionError(`${prefix} must be "<provider>/<model>"${hint}.`);
    }

    return { provider: ref.slice(0, index), modelId: ref.slice(index + 1) };
}

function notConfigured(ref: string, provider: string, subject: Subject): InvalidAgentDefinitionError {
    const envName = `CHAMVI_PROVIDER_${providerEnvName(provider)}`;
    const builtin = BUILTIN_PROVIDERS.find((entry) => entry.id === provider);
    const set = builtin ?
        `Set ${builtin.apiKey}, or ${envName}_TYPE and ${envName}_API_KEY` :
        `Set ${envName}_TYPE and ${envName}_API_KEY`;
    return new InvalidAgentDefinitionError(
        `${subjectOf(ref, subject)} uses provider "${provider}", which is not configured. ${set}, or declare it in chamvi.json.`,
    );
}

/**
 * The resolver model strings go through: every package the settings need is
 * imported up front, each provider name built once with explicit settings
 * (`apiKey`, `baseURL`, `headers`; `name` for openai-compatible), then
 * `check` and `resolve` are synchronous. `models` wins for its ids. A package
 * that is not installed is recorded in `errors` and thrown by `check` and
 * `resolve` for that provider; nothing touches the AI SDK's global provider.
 */
export async function createModelResolver(
    settings: ModelSettings,
    options: ModelResolverOptions = {},
): Promise<ModelResolver> {
    const importer = options.importer ?? defaultImporter;
    const models = options.models ?? {};

    const packages = new Map<string, Loaded>();
    const load = async (specifier: string): Promise<Loaded> => {
        const known = packages.get(specifier);
        if (known) {
            return known;
        }

        let loaded: Loaded;
        try {
            loaded = { exports: await importer(specifier) };
        } catch (error) {
            if (!isPackageNotFound(error, specifier)) {
                throw error;
            }
            loaded = {};
        }
        packages.set(specifier, loaded);
        return loaded;
    };

    const instances = new Map<string, Provider>();
    const errors = new Map<string, string>();

    for (const [name, provider] of settings.providers) {
        if (hasOwn(models, name)) {
            continue;
        }

        const type = PROVIDER_TYPES[provider.type];
        const loaded = await load(type.package);
        if (!('exports' in loaded)) {
            errors.set(name, `Provider type "${provider.type}" needs package ${type.package}.`);
            continue;
        }

        const factory = isObject(loaded.exports) ? loaded.exports[type.factory] : undefined;
        if (typeof factory !== 'function') {
            throw new InvalidAgentDefinitionError(`${type.package} does not export ${type.factory}().`);
        }

        instances.set(name, (factory as Factory)(factoryInput(provider)));
    }

    const providerOf = (ref: string, subject: Subject): { instance: Provider; modelId: string } => {
        const { provider, modelId } = splitRef(ref, subject);
        if (hasOwn(models, provider)) {
            return { instance: models[provider] as Provider, modelId };
        }

        const error = errors.get(provider);
        if (typeof error !== 'undefined') {
            throw new InvalidAgentDefinitionError(error);
        }

        const instance = instances.get(provider);
        if (!instance) {
            throw notConfigured(ref, provider, subject);
        }

        return { instance, modelId };
    };

    return {
        errors,
        check(ref: string, agent?: string): void {
            providerOf(ref, checkSubject(agent));
        },
        resolve(ref: string): LanguageModel {
            const { instance, modelId } = providerOf(ref, { kind: 'model' });
            return instance.languageModel(modelId) as LanguageModel;
        },
    };
}
