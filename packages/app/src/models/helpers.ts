/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { AGENT_NAME_MAX_LENGTH, AGENT_NAME_PATTERN } from '../loader/constants.ts';
import { HEADER_NAME_PATTERN, MODEL_SEPARATOR, PROVIDER_TYPES } from './constants.ts';
import type { ProviderType } from './types.ts';

/**
 * True when the package itself is not installed, not when something it
 * imports is missing: Node's ERR_MODULE_NOT_FOUND "Cannot find package
 * '<specifier>'", or Vite's (the Vitest module runner's) code-less
 * "Could not resolve "<specifier>"".
 */
export function isPackageNotFound(error: unknown, specifier: string): boolean {
    if (!isObject(error) || typeof error.message !== 'string') {
        return false;
    }

    if (error.code === 'ERR_MODULE_NOT_FOUND') {
        return error.message.startsWith(`Cannot find package '${specifier}'`);
    }

    return error.code === undefined && error.message.startsWith(`Could not resolve "${specifier}"`);
}

export function defaultImporter(specifier: string): Promise<unknown> {
    return import(specifier);
}

/** The env form of a provider name: `team-a` -> `TEAM_A` (as in `CHAMVI_PROVIDER_TEAM_A_TYPE`). */
export function providerEnvName(name: string): string {
    return name.toUpperCase().replaceAll('-', '_');
}

/** The provider name of an env form (`TEAM_A` -> `team-a`), undefined when that is no provider name (the agent-name rule). */
export function providerName(envName: string): string | undefined {
    if (envName !== envName.toUpperCase()) {
        return undefined;
    }

    const name = envName.toLowerCase().replaceAll('_', '-');

    if (name.length > AGENT_NAME_MAX_LENGTH || !AGENT_NAME_PATTERN.test(name)) {
        return undefined;
    }

    return name;
}

/** True when `name` follows the agent-name rule (`team-a`, `a1`). */
export function isProviderName(name: string): boolean {
    return providerName(providerEnvName(name)) === name;
}

export function isProviderType(value: unknown): value is ProviderType {
    return typeof value === 'string' && Object.hasOwn(PROVIDER_TYPES, value);
}

/** The header name of an env suffix: `X_TEAM` -> `x-team`. */
export function headerName(envName: string): string {
    return envName.toLowerCase().replaceAll('_', '-');
}

/** The header name lower-cased; InvalidAgentDefinitionError naming `field` when it breaks HEADER_NAME_PATTERN. */
export function assertHeaderName(name: string, field: string): string {
    const lower = name.toLowerCase();

    if (!HEADER_NAME_PATTERN.test(lower)) {
        throw new InvalidAgentDefinitionError(
            `${field} names a header that is not lower-kebab (must match ${HEADER_NAME_PATTERN}).`,
        );
    }

    return lower;
}

/** `<provider>/<model>` split at the first `/`; undefined when either part is empty. */
export function splitModelRef(ref: string): { provider: string; model: string } | undefined {
    const index = ref.indexOf(MODEL_SEPARATOR);

    if (index <= 0 || index === ref.length - 1) {
        return undefined;
    }

    return {
        provider: ref.slice(0, index),
        model: ref.slice(index + MODEL_SEPARATOR.length),
    };
}

/**
 * The value when it is an absolute http(s) URL without credentials, query or
 * fragment; else InvalidAgentDefinitionError naming `field`, never the value.
 */
export function assertBaseUrl(value: string, field: string): string {
    let url: URL | undefined;

    try {
        url = new URL(value);
    } catch {
        url = undefined;
    }

    if (
        !url ||
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== '' ||
        url.search !== '' ||
        url.hash !== '' ||
        value.includes('?') ||
        value.includes('#')
    ) {
        throw new InvalidAgentDefinitionError(
            `${field} must be an absolute http(s) URL without credentials, query or fragment.`,
        );
    }

    return value;
}

/** A base URL for display: origin plus pathname. */
export function describeBaseUrl(url: string): string {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname}`;
}
