/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import type { ContextKey } from './types.ts';

/** Every key defineContextKey() made in this copy of @chamvi/core. */
const keys = new WeakSet<object>();

/** Each execution's ToolContext -> its engine's provided values (by reference). */
const bindings = new WeakMap<object, ReadonlyMap<ContextKey<unknown>, unknown>>();

export function registerContextKey(key: ContextKey<unknown>): void {
    keys.add(key);
}

export function isContextKey(value: unknown): value is ContextKey<unknown> {
    return isObject(value) && keys.has(value);
}

/** Binds `values` to `ctx` without adding any property to it. */
export function bindProvided(ctx: object, values: ReadonlyMap<ContextKey<unknown>, unknown>): void {
    bindings.set(ctx, values);
}

export function providedOf(ctx: object): ReadonlyMap<ContextKey<unknown>, unknown> | undefined {
    return bindings.get(ctx);
}

/** The key's name for a message, `<unnamed>` for a foreign key without a string name. */
export function contextKeyName(key: unknown): string {
    if (isObject(key) && typeof key.name === 'string') {
        return key.name;
    }

    return '<unnamed>';
}
