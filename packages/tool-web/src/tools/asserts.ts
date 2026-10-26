/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';
import { ValidationError } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';

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

/** An integer in `[min, max]` or undefined, else a ValidationError. */
export function optionalInteger(value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new ValidationError(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

/** One of `allowed` or undefined, else a ValidationError. */
export function optionalOneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new ValidationError(`${name} must be one of ${allowed.join(', ')}.`);
    }
    return value as T;
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
