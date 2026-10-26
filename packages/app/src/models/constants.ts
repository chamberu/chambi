/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { BuiltinProvider, ProviderType } from './types.ts';

/**
 * The implicit providers: the bare variables (`apiKey`, `baseUrl`) that create a
 * provider named after its type. New code reads only `id`, `apiKey` and `baseUrl`
 * here; `package` and `factory` stay for the exported shape, PROVIDER_TYPES is
 * the one source of package, factory and default URL.
 */
export const BUILTIN_PROVIDERS: readonly BuiltinProvider[] = [
    {
        id: 'anthropic',
        package: '@ai-sdk/anthropic',
        factory: 'createAnthropic',
        apiKey: 'ANTHROPIC_API_KEY',
        baseUrl: 'ANTHROPIC_BASE_URL',
    },
    {
        id: 'openai',
        package: '@ai-sdk/openai',
        factory: 'createOpenAI',
        apiKey: 'OPENAI_API_KEY',
        baseUrl: 'OPENAI_BASE_URL',
    },
    {
        id: 'google',
        package: '@ai-sdk/google',
        factory: 'createGoogleGenerativeAI',
        apiKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    },
    {
        id: 'mistral',
        package: '@ai-sdk/mistral',
        factory: 'createMistral',
        apiKey: 'MISTRAL_API_KEY',
    },
    {
        id: 'xai',
        package: '@ai-sdk/xai',
        factory: 'createXai',
        apiKey: 'XAI_API_KEY',
    },
];

/** Between provider and model id in a model string, as the AI SDK writes them (`openai/gpt-5`). */
export const MODEL_SEPARATOR = '/';

/**
 * Package, factory and public default URL per provider type (default URLs as the
 * packages' dist read 2026-10-25). `openai-compatible` has no default: its
 * `baseURL` is required, and it alone may go without a key.
 */
export const PROVIDER_TYPES: Readonly<Record<ProviderType, {
    /** The npm package. */
    package: string;
    /** The factory the package exports. */
    factory: string;
    /** The base URL the factory gets when none is set; empty when the type has none. */
    defaultBaseURL: string;
    /** Whether a provider of this type needs an `apiKey`. */
    keyRequired: boolean;
}>> = {
    anthropic: {
        package: '@ai-sdk/anthropic',
        factory: 'createAnthropic',
        defaultBaseURL: 'https://api.anthropic.com/v1',
        keyRequired: true,
    },
    openai: {
        package: '@ai-sdk/openai',
        factory: 'createOpenAI',
        defaultBaseURL: 'https://api.openai.com/v1',
        keyRequired: true,
    },
    'openai-compatible': {
        package: '@ai-sdk/openai-compatible',
        factory: 'createOpenAICompatible',
        defaultBaseURL: '',
        keyRequired: false,
    },
    google: {
        package: '@ai-sdk/google',
        factory: 'createGoogleGenerativeAI',
        defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
        keyRequired: true,
    },
    mistral: {
        package: '@ai-sdk/mistral',
        factory: 'createMistral',
        defaultBaseURL: 'https://api.mistral.ai/v1',
        keyRequired: true,
    },
    xai: {
        package: '@ai-sdk/xai',
        factory: 'createXai',
        defaultBaseURL: 'https://api.x.ai/v1',
        keyRequired: true,
    },
    gateway: {
        package: 'ai',
        factory: 'createGateway',
        defaultBaseURL: 'https://ai-gateway.vercel.sh/v4/ai',
        keyRequired: true,
    },
};

/** Header names whose config file value must be `{ env }` or `{ file }`, never a literal. */
export const SECRET_HEADER_PATTERN = /authorization|api[-_]?key|token|secret|auth/i;

/** The only header names an env variable can carry, so code and the config file get the same rule. */
export const HEADER_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Read from the cwd when it exists and CHAMVI_CONFIG_FILE is unset. */
export const DEFAULT_CONFIG_FILE = 'chamvi.json';
