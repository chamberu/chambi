/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ModelRef } from '@chamvi/core';
import { envString } from '../env/module.ts';
import type { Env } from '../env/types.ts';
import {
    BUILTIN_PROVIDERS,
    DEFAULT_CONFIG_FILE,
    PROVIDER_TYPES,
} from './constants.ts';
import { readConfigFile } from './file.ts';
import {
    assertBaseUrl,
    assertHeaderName,
    headerName,
    isProviderName,
    isProviderType,
    providerEnvName,
    providerName,
} from './helpers.ts';
import { readSecret } from './secret.ts';
import type {
    ModelIssue,
    ModelSettings,
    ProviderConfig,
    ProviderSettings,
    ProviderType,
    SecretValue,
    SettingSource,
} from './types.ts';

const ENV_PREFIX = 'CHAMVI_PROVIDER_';
const CONFIG_FILE_VARIABLE = 'CHAMVI_CONFIG_FILE';
const MODEL_VARIABLE = 'CHAMVI_MODEL';
const HEADER_PREFIX = 'HEADER_';

/** One field value of one source: the value and the field or variable named in errors. */
type Field<T> = {
    value: T;
    source: SettingSource;
    label: string
};

/** What one source says about one provider name. */
type Layer = {
    type?: { value: ProviderType; source: SettingSource };
    apiKey?: Field<SecretValue>;
    baseURL?: Field<string>;
    headers: Record<string, Field<SecretValue>>;
};

type EnvField = { kind: 'type' | 'apiKey' | 'baseURL' } | { kind: 'header'; header: string };

type EnvBinding = {
    variable: string;
    value: string;
    name: string;
    field: EnvField
};

type Issues = {
    list: ModelIssue[];
    /** Provider names with an issue: left out of the settings. */
    failed: Set<string>;
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function report(issues: Issues, message: string, provider?: string): void {
    if (typeof provider === 'undefined') {
        issues.list.push({ message });
        return;
    }

    issues.list.push({ provider, message });
    issues.failed.add(provider);
}

function attempt(issues: Issues, provider: string | undefined, fn: () => void): void {
    try {
        fn();
    } catch (error) {
        report(issues, messageOf(error), provider);
    }
}

function emptyLayer(): Layer {
    return { headers: {} };
}

/** A code or config file provider as a layer; a problem is an issue for the name. */
function configLayer(name: string, config: ProviderConfig, source: SettingSource, prefix: string, issues: Issues): Layer {
    const layer = emptyLayer();
    const field = `${prefix}providers.${name}`;
    const raw: unknown = config.type;
    if (isProviderType(raw)) {
        layer.type = { value: raw, source };
    } else {
        report(issues, `${field}.type must be one of ${Object.keys(PROVIDER_TYPES).join(', ')}.`, name);
    }

    if (typeof config.apiKey !== 'undefined') {
        layer.apiKey = {
            value: config.apiKey,
            source,
            label: `${field}.apiKey`,
        };
    }

    if (typeof config.baseURL !== 'undefined') {
        const label = `${field}.baseURL`;
        attempt(issues, name, () => {
            layer.baseURL = {
                value: assertBaseUrl(String(config.baseURL), label),
                source,
                label,
            };
        });
    }

    for (const [header, value] of Object.entries(config.headers ?? {})) {
        const label = `${field}.headers.${header}`;
        attempt(issues, name, () => {
            layer.headers[assertHeaderName(header, label)] = {
                value,
                source,
                label,
            };
        });
    }

    return layer;
}

function parseEnvField(suffix: string): EnvField | undefined {
    if (suffix === 'TYPE') {
        return { kind: 'type' };
    }

    if (suffix === 'API_KEY') {
        return { kind: 'apiKey' };
    }

    if (suffix === 'BASE_URL') {
        return { kind: 'baseURL' };
    }

    if (suffix.startsWith(HEADER_PREFIX) && suffix.length > HEADER_PREFIX.length) {
        return { kind: 'header', header: suffix.slice(HEADER_PREFIX.length) };
    }

    return undefined;
}

/** Binds `rest` (the variable without the prefix) to the longest name it fits. */
function bindEnv(rest: string, names: readonly string[]): { name: string; field: EnvField } | undefined {
    const sorted = [...names].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
        const envName = `${providerEnvName(name)}_`;
        if (rest.startsWith(envName)) {
            const field = parseEnvField(rest.slice(envName.length));
            if (field) {
                return { name, field };
            }
        }
    }

    return undefined;
}

/** The provider name a variable that fits no declared name most likely means. */
function guessName(rest: string): string | undefined {
    for (const suffix of ['_TYPE', '_API_KEY', '_BASE_URL']) {
        if (rest.endsWith(suffix)) {
            return providerName(rest.slice(0, -suffix.length));
        }
    }

    const index = rest.indexOf(`_${HEADER_PREFIX}`);
    return providerName(index === -1 ? rest : rest.slice(0, index));
}

/**
 * Binds every `CHAMVI_PROVIDER_*` variable: (1) to the names code and file
 * declare, longest first; (2) a still unmatched `_TYPE` declares an env-only
 * provider; (3) the rest bind to those; (4) anything left is an issue.
 */
function bindEnvVariables(env: Env, declared: ReadonlySet<string>, issues: Issues): EnvBinding[] {
    const unmatched: Array<{
        variable: string;
        value: string;
        rest: string
    }> = [];
    const bindings: EnvBinding[] = [];
    for (const variable of Object.keys(env).sort()) {
        const value = variable.startsWith(ENV_PREFIX) ? envString(env, variable) : undefined;
        if (typeof value === 'undefined') {
            continue;
        }

        const rest = variable.slice(ENV_PREFIX.length);
        const bound = bindEnv(rest, [...declared]);
        if (bound) {
            bindings.push({
                variable,
                value,
                ...bound,
            });
        } else {
            unmatched.push({
                variable,
                value,
                rest,
            });
        }
    }

    const envDeclared = new Set<string>();
    for (const { rest } of unmatched) {
        const name = rest.endsWith('_TYPE') ? providerName(rest.slice(0, -'_TYPE'.length)) : undefined;
        if (name) {
            envDeclared.add(name);
        }
    }

    for (const {
        variable,
        value,
        rest,
    } of unmatched) {
        const bound = bindEnv(rest, [...envDeclared]);
        if (bound) {
            bindings.push({
                variable,
                value,
                ...bound,
            });
            continue;
        }

        const name = guessName(rest);
        if (name) {
            report(
                issues,
                `${variable} names provider "${name}", which no source declares; ` +
                `set ${ENV_PREFIX}${providerEnvName(name)}_TYPE or fix the name.`,
                name,
            );
        } else {
            report(
                issues,
                `${variable} names no provider; provider variables are ${ENV_PREFIX}<NAME>_TYPE, _API_KEY, _BASE_URL ` +
                'or _HEADER_<HEADER>, with <NAME> the upper-snake provider name.',
            );
        }
    }

    return bindings;
}

function applyEnvBinding(layer: Layer, binding: EnvBinding, issues: Issues): void {
    const {
        variable,
        value,
        name,
        field,
    } = binding;
    const source: SettingSource = 'env';
    switch (field.kind) {
        case 'type':
            if (isProviderType(value)) {
                layer.type = { value, source };
            } else {
                report(issues, `${variable} must be one of ${Object.keys(PROVIDER_TYPES).join(', ')}.`, name);
            }
            break;
        case 'apiKey':
            layer.apiKey = {
                value,
                source,
                label: variable,
            };
            break;
        case 'baseURL':
            attempt(issues, name, () => {
                layer.baseURL = {
                    value: assertBaseUrl(value, variable),
                    source,
                    label: variable,
                };
            });
            break;
        default:
            attempt(issues, name, () => {
                layer.headers[assertHeaderName(headerName(field.header), variable)] = {
                    value,
                    source,
                    label: variable,
                };
            });
    }
}

/** Layers merged low to high: per field, or wholesale when a higher layer sets another type. */
function mergeLayers(layers: readonly Layer[]): Layer | undefined {
    let merged: Layer | undefined;
    for (const layer of layers) {
        if (!merged || (layer.type && merged.type && layer.type.value !== merged.type.value)) {
            merged = { ...layer, headers: { ...layer.headers } };
            continue;
        }

        merged = {
            type: layer.type ?? merged.type,
            apiKey: layer.apiKey ?? merged.apiKey,
            baseURL: layer.baseURL ?? merged.baseURL,
            headers: { ...merged.headers, ...layer.headers },
        };
    }

    return merged;
}

async function resolveProvider(
    name: string,
    layer: Layer,
    context: { env: Env; cwd: string },
    issues: Issues,
): Promise<ProviderSettings | undefined> {
    if (!layer.type) {
        return undefined;
    }

    const settings: ProviderSettings = {
        name,
        type: layer.type.value,
        headers: {},
        sources: { type: layer.type.source, headers: {} },
    };
    try {
        if (layer.apiKey) {
            settings.apiKey = await readSecret(layer.apiKey.value, { ...context, field: layer.apiKey.label });
            settings.sources.apiKey = layer.apiKey.source;
        }

        for (const [header, field] of Object.entries(layer.headers)) {
            settings.headers[header] = await readSecret(field.value, { ...context, field: field.label });
            settings.sources.headers[header] = field.source;
        }
    } catch (error) {
        report(issues, messageOf(error), name);
        return undefined;
    }

    if (layer.baseURL) {
        settings.baseURL = layer.baseURL.value;
        settings.sources.baseURL = layer.baseURL.source;
    }

    if (issues.failed.has(name)) {
        // A refused field reads as missing; its own issue already names it.
        return undefined;
    }

    const envName = `${ENV_PREFIX}${providerEnvName(name)}`;
    if (PROVIDER_TYPES[settings.type].keyRequired && typeof settings.apiKey === 'undefined') {
        report(issues, `Provider "${name}" (${settings.type}) needs ${envName}_API_KEY.`, name);
    }

    if (settings.type === 'openai-compatible' && typeof settings.baseURL === 'undefined') {
        report(issues, `Provider "${name}" (${settings.type}) needs ${envName}_BASE_URL.`, name);
    }

    return settings;
}

function implicitProviders(env: Env, declared: ReadonlySet<string>, issues: Issues): ProviderSettings[] {
    const providers: ProviderSettings[] = [];
    for (const builtin of BUILTIN_PROVIDERS) {
        const apiKey = declared.has(builtin.id) ? undefined : envString(env, builtin.apiKey);
        if (typeof apiKey === 'undefined' || !isProviderType(builtin.id)) {
            continue;
        }

        const settings: ProviderSettings = {
            name: builtin.id,
            type: builtin.id,
            apiKey,
            headers: {},
            sources: {
                type: 'implicit',
                apiKey: 'implicit',
                headers: {},
            },
        };
        const baseURL = builtin.baseUrl ? envString(env, builtin.baseUrl) : undefined;
        if (builtin.baseUrl && typeof baseURL !== 'undefined') {
            try {
                settings.baseURL = assertBaseUrl(baseURL, builtin.baseUrl);
                settings.sources.baseURL = 'implicit';
            } catch (error) {
                report(issues, messageOf(error), builtin.id);
                continue;
            }
        }

        providers.push(settings);
    }

    return providers;
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function readFileLayer(
    env: Env,
    cwd: string,
    issues: Issues,
): Promise<{
    path?: string;
    model?: string;
    providers: Record<string, ProviderConfig>
}> {
    const named = envString(env, CONFIG_FILE_VARIABLE);
    const path = resolve(cwd, named ?? DEFAULT_CONFIG_FILE);
    if (typeof named === 'undefined' && !(await exists(path))) {
        return { providers: {} };
    }

    try {
        return { path, ...(await readConfigFile(path)) };
    } catch (error) {
        report(issues, typeof named === 'undefined' ? messageOf(error) : `${CONFIG_FILE_VARIABLE}: ${messageOf(error)}`);
        return { providers: {} };
    }
}

/**
 * The app's model settings, layered per provider name and field: env over the
 * config file (`CHAMVI_CONFIG_FILE`, else `./chamvi.json` when it exists) over
 * code. Collects every issue; a provider with an issue is left out. No issue
 * holds a secret value.
 */
export async function readModelSettings(input: {
    env: Env;
    cwd: string;
    model?: ModelRef;
    providers?: Readonly<Record<string, ProviderConfig>>;
}): Promise<{ settings: ModelSettings; issues: ModelIssue[] }> {
    const { env, cwd } = input;
    const issues: Issues = { list: [], failed: new Set() };
    const layers = new Map<string, Layer[]>();
    const add = (name: string, layer: Layer) => {
        layers.set(name, [...(layers.get(name) ?? []), layer]);
    };

    for (const [name, config] of Object.entries(input.providers ?? {})) {
        if (!isProviderName(name)) {
            report(issues, `createApp: providers.${name} is no provider name (must match ^[a-z0-9]+(-[a-z0-9]+)*$, at most 64 characters).`);
            continue;
        }

        add(name, configLayer(name, config, 'code', 'createApp: ', issues));
    }

    const file = await readFileLayer(env, cwd, issues);
    for (const [name, config] of Object.entries(file.providers)) {
        add(name, configLayer(name, config, 'file', '', issues));
    }

    const envLayers = new Map<string, Layer>();
    for (const binding of bindEnvVariables(env, new Set(layers.keys()), issues)) {
        const layer = envLayers.get(binding.name) ?? emptyLayer();
        envLayers.set(binding.name, layer);
        applyEnvBinding(layer, binding, issues);
    }

    for (const [name, layer] of envLayers) {
        add(name, layer);
    }

    const providers = new Map<string, ProviderSettings>();
    for (const [name, list] of layers) {
        const merged = mergeLayers(list);
        const settings = merged ? await resolveProvider(name, merged, { env, cwd }, issues) : undefined;
        if (settings && !issues.failed.has(name)) {
            providers.set(name, settings);
        }
    }

    for (const settings of implicitProviders(env, new Set(layers.keys()), issues)) {
        if (!issues.failed.has(settings.name)) {
            providers.set(settings.name, settings);
        }
    }

    const settings: ModelSettings = { providers };
    const envModel = envString(env, MODEL_VARIABLE);
    if (typeof envModel !== 'undefined') {
        settings.model = { ref: envModel, source: 'env' };
    } else if (typeof file.model !== 'undefined') {
        settings.model = { ref: file.model, source: 'file' };
    } else if (typeof input.model !== 'undefined') {
        settings.model = { ref: input.model, source: 'code' };
    }

    if (typeof file.path !== 'undefined') {
        settings.configFile = file.path;
    }

    return { settings, issues: issues.list };
}
