/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';
import {
    InvalidAgentDefinitionError,
    ValidationError,
    systemClock,
} from '@chamvi/core';
import type { IClock, ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import { systemLookup } from '../request/asserts.ts';
import { WEB_FETCH_MAX_BYTES, WEB_TIMEOUT_MS } from '../request/constants.ts';
import { createRequester } from '../request/module.ts';
import { fetchTransport, pinnedTransport } from '../request/transport.ts';
import type { Requester } from '../request/types.ts';
import { DEFAULT_REGISTRIES } from '../registry/constants.ts';
import type { PackageEcosystem } from '../registry/types.ts';
import { TIMER_MAX_MS } from './constants.ts';
import type { ISearchProvider, WebToolsOptions } from './types.ts';

export type ResolvedWebOptions = {
    request: Requester;
    search?: ISearchProvider;
    registries: Record<PackageEcosystem, string>;
    clock: IClock;
    timeoutMs: number;
};

function optionalFunction(value: unknown, name: string): void {
    if (value !== undefined && typeof value !== 'function') {
        throw new InvalidAgentDefinitionError(`webTools() ${name} must be a function.`);
    }
}

function positiveInteger(value: unknown, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new InvalidAgentDefinitionError(`webTools() ${name} must be an integer from 1 to ${max}.`);
    }
    return value;
}

/** The registries: the defaults, overridden by absolute http(s) URLs without query or hash (trailing slashes dropped). */
function resolveRegistries(value: unknown): Record<PackageEcosystem, string> {
    if (value === undefined) return { ...DEFAULT_REGISTRIES };
    if (!isObject(value)) {
        throw new InvalidAgentDefinitionError('webTools() registries must be an object.');
    }
    const registries = { ...DEFAULT_REGISTRIES };
    for (const [key, url] of Object.entries(value)) {
        if (!(key in DEFAULT_REGISTRIES)) {
            throw new InvalidAgentDefinitionError(`webTools() registries has no ecosystem ${JSON.stringify(key)}; known: ${Object.keys(DEFAULT_REGISTRIES).join(', ')}.`);
        }
        let parsed: URL | undefined;
        try {
            parsed = typeof url === 'string' ? new URL(url) : undefined;
        } catch {
            parsed = undefined;
        }
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash || parsed.username || parsed.password) {
            throw new InvalidAgentDefinitionError(`webTools() registries.${key} must be an absolute http or https URL without credentials, query or hash.`);
        }
        registries[key as PackageEcosystem] = parsed.href.replace(/\/+$/, '');
    }
    return registries;
}

/** Every option checked (InvalidAgentDefinitionError), the requester built. */
export function resolveOptions(options: WebToolsOptions): ResolvedWebOptions {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('webTools() options must be an object.');
    }
    optionalFunction(options.fetch, 'fetch');
    optionalFunction(options.lookup, 'lookup');
    optionalFunction(options.allowUrl, 'allowUrl');
    if (options.search !== undefined && (!isObject(options.search) || typeof options.search.search !== 'function')) {
        throw new InvalidAgentDefinitionError('webTools() search must be a search provider with search().');
    }
    const clock = options.clock ?? systemClock;
    if (!isObject(clock) || typeof clock.now !== 'function' || typeof clock.setTimeout !== 'function') {
        throw new InvalidAgentDefinitionError('webTools() clock must have now() and setTimeout().');
    }
    const maxBytes = positiveInteger(options.maxBytes, 'maxBytes', WEB_FETCH_MAX_BYTES);
    const timeoutMs = positiveInteger(options.timeoutMs, 'timeoutMs', WEB_TIMEOUT_MS, TIMER_MAX_MS);
    const request = createRequester({
        transport: options.fetch ? fetchTransport(options.fetch) : pinnedTransport,
        lookup: options.lookup ?? systemLookup,
        allowUrl: options.allowUrl,
        maxBytes,
        timeoutMs,
        clock,
    });
    return {
        request,
        registries: resolveRegistries(options.registries),
        search: options.search,
        clock,
        timeoutMs,
    };
}

/** The tool input as an object, else a ValidationError (a tool error the model can correct). */
export function inputObject(input: unknown): Record<string, unknown> {
    if (!isObject(input)) {
        throw new ValidationError('The tool input must be an object.');
    }
    return input;
}

/** A non-empty string, else a ValidationError. */
export function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ValidationError(`${name} must be a non-empty string.`);
    }
    return value;
}

/** A non-empty string or undefined, else a ValidationError. */
export function optionalString(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : requireString(value, name);
}

/** An integer in `[min, max]` or undefined, else a ValidationError. */
export function optionalInteger(value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new ValidationError(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

/** One of `allowed`, else a ValidationError. */
export function requireOneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new ValidationError(`${name} must be one of ${allowed.join(', ')}.`);
    }
    return value as T;
}

/** One of `allowed` or undefined, else a ValidationError. */
export function optionalOneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | undefined {
    return value === undefined ? undefined : requireOneOf(value, name, allowed);
}

/** The call's abort signal combined with the run's. */
export function signalOf(abortSignal: AbortSignal | undefined, context: ToolContext): AbortSignal {
    const { signal } = context.run;
    if (!abortSignal || abortSignal === signal) return signal;
    return AbortSignal.any([abortSignal, signal]);
}

/** `text` from `offset`, at most `max` UTF-16 units, never ending inside a surrogate pair. */
export function cutText(text: string, offset: number, max: number): string {
    const end = offset + max;
    if (end >= text.length) return text.slice(offset);
    const code = text.charCodeAt(end - 1);
    return text.slice(offset, code >= 0xD800 && code <= 0xDBFF ? end - 1 : end);
}

/** An object schema of `properties`, the `required` ones required. */
export function objectSchema<T>(properties: Record<string, JSONSchema7>, required: string[] = []) {
    return jsonSchema<T>({
        type: 'object',
        properties,
        required,
        additionalProperties: false,
    });
}
