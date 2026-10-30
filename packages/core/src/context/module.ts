/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ContextNotProvidedError, InvalidAgentDefinitionError } from '../errors/index.ts';
import type { StateSchema } from '../state/types.ts';
import type { ToolContext } from '../tool/types.ts';
import {
    contextKeyName,
    isContextKey,
    providedOf,
    registerContextKey,
} from './helpers.ts';
import type { ContextKey } from './types.ts';

/** A new, unique key; two calls with one name give two independent keys. */
export function defineContextKey<T>(name: string): ContextKey<T> {
    if (typeof name !== 'string' || name.length === 0) {
        throw new InvalidAgentDefinitionError('defineContextKey() needs a non-empty name.');
    }

    const key: ContextKey<T> = Object.freeze({ name });

    registerContextKey(key);

    return key;
}

/**
 * The value provided on the engine under `key` for this execution's
 * ToolContext (tool `execute`, the tools factory, effect hooks), or undefined.
 */
export function tryInject<T, S extends StateSchema = StateSchema>(
    ctx: ToolContext<S>,
    key: ContextKey<T>,
): T | undefined {
    if (!isContextKey(key)) {
        return undefined;
    }

    return providedOf(ctx)?.get(key) as T | undefined;
}

/** Like tryInject, but throws ContextNotProvidedError (naming the key only) without a value. */
export function inject<T, S extends StateSchema = StateSchema>(ctx: ToolContext<S>, key: ContextKey<T>): T {
    const value = tryInject(ctx, key);

    if (value === undefined) {
        throw new ContextNotProvidedError(contextKeyName(key));
    }

    return value;
}
