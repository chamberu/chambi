/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { toArray, toBool, toInt } from 'envix';
import type {
    Env,
    EnvDefinedOptions,
    EnvIntegerOptions,
    EnvJsonOptions,
    EnvReadOptions,
    EnvStringOptions,
    EnvUrlOptions,
} from './types.ts';

const INTEGER_PATTERN = /^\d+$/;
const BOOLEAN_PATTERN = /^(?:true|false|1|0)$/;

// Every message names the variable and the rule, never the value (it may be a secret).
function fail(message: string): never {
    throw new InvalidAgentDefinitionError(message);
}

/**
 * The raw value, or undefined for an unset or empty variable;
 * throws for a required one without a default.
 */
function readRaw<T>(env: Env, name: string, options: EnvReadOptions<T> | undefined): string | undefined {
    const value = env[name];

    if (typeof value === 'string' && value.length > 0) {
        return value;
    }

    if (options?.required && typeof options.default === 'undefined') {
        fail(`${name} is required.`);
    }

    return undefined;
}

export function envString(env: Env, name: string, options: EnvStringOptions & EnvDefinedOptions<string>): string;
export function envString(env: Env, name: string, options?: EnvStringOptions): string | undefined;
export function envString(env: Env, name: string, options?: EnvStringOptions): string | undefined {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return options?.default;
    }

    if (typeof options?.minLength === 'number' && value.length < options.minLength) {
        fail(`${name} must be at least ${options.minLength} characters.`);
    }

    return value;
}

export function envInteger(env: Env, name: string, options: EnvIntegerOptions & EnvDefinedOptions<number>): number;
export function envInteger(env: Env, name: string, options?: EnvIntegerOptions): number | undefined;
export function envInteger(env: Env, name: string, options?: EnvIntegerOptions): number | undefined {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return options?.default;
    }

    const parsed = INTEGER_PATTERN.test(value) ? toInt(value) : undefined;

    if (typeof parsed === 'undefined' || !Number.isSafeInteger(parsed)) {
        fail(`${name} must be a non-negative integer.`);
    }

    if (typeof options?.min === 'number' && parsed < options.min) {
        fail(`${name} must be at least ${options.min}.`);
    }

    if (typeof options?.max === 'number' && parsed > options.max) {
        fail(`${name} must be at most ${options.max}.`);
    }

    return parsed;
}

export function envBoolean(env: Env, name: string, options: EnvReadOptions<boolean> & EnvDefinedOptions<boolean>): boolean;
export function envBoolean(env: Env, name: string, options?: EnvReadOptions<boolean>): boolean | undefined;
export function envBoolean(env: Env, name: string, options?: EnvReadOptions<boolean>): boolean | undefined {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return options?.default;
    }

    const parsed = BOOLEAN_PATTERN.test(value) ? toBool(value) : undefined;

    if (typeof parsed === 'undefined') {
        fail(`${name} must be one of true, false, 1, 0.`);
    }

    return parsed;
}

export function envUrl(env: Env, name: string, options: EnvUrlOptions & EnvDefinedOptions<string>): string;
export function envUrl(env: Env, name: string, options?: EnvUrlOptions): string | undefined;
export function envUrl(env: Env, name: string, options?: EnvUrlOptions): string | undefined {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return options?.default;
    }

    if (!URL.canParse(value)) {
        fail(`${name} must be an absolute URL.`);
    }

    const url = new URL(value);

    if (options?.protocols && !options.protocols.includes(url.protocol)) {
        fail(`${name} must use one of the protocols ${options.protocols.join(', ')}.`);
    }

    return value.replace(/\/+$/, '');
}

export function envList(env: Env, name: string, options: EnvReadOptions<string[]> & EnvDefinedOptions<string[]>): string[];
export function envList(env: Env, name: string, options?: EnvReadOptions<string[]>): string[] | undefined;
export function envList(env: Env, name: string, options?: EnvReadOptions<string[]>): string[] | undefined {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return options?.default;
    }

    return toArray(value, ',') ?? [];
}

export function envJson(env: Env, name: string, options?: EnvJsonOptions): unknown {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return undefined;
    }

    try {
        return JSON.parse(value);
    } catch {
        // never the parser's message: V8 quotes the input in it
        return fail(`${name} must be valid JSON.`);
    }
}

export function envOneOf<T extends string>(
    env: Env,
    name: string,
    values: readonly T[],
    options: EnvReadOptions<T> & EnvDefinedOptions<T>,
): T;
export function envOneOf<T extends string>(env: Env, name: string, values: readonly T[], options?: EnvReadOptions<T>): T | undefined;
export function envOneOf<T extends string>(env: Env, name: string, values: readonly T[], options?: EnvReadOptions<T>): T | undefined {
    const value = readRaw(env, name, options);

    if (typeof value === 'undefined') {
        return options?.default;
    }

    if (!(values as readonly string[]).includes(value)) {
        fail(`${name} must be one of ${values.join(', ')}.`);
    }

    return value as T;
}
