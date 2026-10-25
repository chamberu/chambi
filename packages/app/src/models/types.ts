/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent, ModelRef } from '@chamvi/core';
import type { ProviderRegistryProvider, createProviderRegistry } from 'ai';
import type { Env } from '../env/types.ts';
import type { MODEL_SEPARATOR } from './constants.ts';

/** createApp's `models`: providers by id, as `createProviderRegistry()` takes them. */
export type ModelProviders = Parameters<typeof createProviderRegistry>[0];

/** The registry model strings resolve through: `<provider>/<model>`. */
export type ModelRegistry = ProviderRegistryProvider<ModelProviders, typeof MODEL_SEPARATOR>;

/** What a provider is built with: the AI SDK package and factory behind a provider name. */
export type ProviderType = 'anthropic' | 'openai' | 'openai-compatible' | 'google' | 'mistral' | 'xai' | 'gateway';

/** A secret: a literal, an env variable of the app's env, or a file (relative to the cwd, one trailing newline trimmed). */
export type SecretValue = string | { env: string } | { file: string };

/** A named provider, as createApp's `providers` and the config file declare it. */
export type ProviderConfig = {
    type: ProviderType;
    apiKey?: SecretValue;
    /** Absolute http(s) URL without credentials, query or fragment; default the type's public URL. */
    baseURL?: string;
    /** Header names match `^[a-z0-9]+(-[a-z0-9]+)*$` (lower-cased first). */
    headers?: Record<string, SecretValue>;
};

/** Where a setting came from: an env variable, the config file, createApp's options, or a bare provider variable. */
export type SettingSource = 'env' | 'file' | 'code' | 'implicit';

/** A provider after merging code, config file and env: secrets resolved, header names lower-cased. */
export type ProviderSettings = {
    name: string;
    type: ProviderType;
    apiKey?: string;
    baseURL?: string;
    headers: Record<string, string>;
    /** Where each field came from. */
    sources: {
        type: SettingSource;
        apiKey?: SettingSource;
        baseURL?: SettingSource;
        headers: Record<string, SettingSource>;
    };
};

/** The app's model settings: the default model and the providers that were read without an issue. */
export type ModelSettings = {
    model?: { ref: ModelRef; source: SettingSource };
    providers: ReadonlyMap<string, ProviderSettings>;
    /** The config file read (absolute), when one was. */
    configFile?: string;
};

/** A problem found while reading the settings; never holds a secret value. */
export type ModelIssue = {
    provider?: string;
    message: string;
};

/** A provider package `createModelRegistry()` discovers when it is installed. */
export type BuiltinProvider = {
    /** The registry id, the part of a model string before the first `/`. */
    id: string;
    /** The npm package. */
    package: string;
    /** The factory the package exports. */
    factory: string;
    /** The env variable holding the API key. */
    apiKey: string;
    /** The env variable holding a base URL, when the provider reads one. */
    baseUrl?: string;
};

export type ModelRegistryOptions = {
    agents: readonly Agent[];
    env: Env;
    models?: ModelProviders;
    /** Loads a provider package; default `(s) => import(s)`. */
    importer?: (specifier: string) => Promise<unknown>;
};

/** Throws InvalidAgentDefinitionError when the agent's string model cannot resolve (a non-string model passes). */
export type ModelCheck = (agent: Agent) => void;

export type ResolvedModels = {
    registry: ModelRegistry;
    /** The check every agent of `agents` passed, for agents registered later (folder agents). */
    check: ModelCheck;
};
