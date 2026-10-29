/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

declare const CONTEXT_VALUE: unique symbol;

/**
 * A typed key for a value provided on the engine; unique per
 * `defineContextKey()` call, its name is used in messages only.
 */
export type ContextKey<T> = {
    readonly name: string;
    /** Carries the value type only; never set. */
    readonly [CONTEXT_VALUE]?: T;
};

/** Holds values tools reach through `inject(ctx, key)`. */
export interface IContextProvider {
    /** Repositories `value` by reference under `key`. */
    provide<T>(key: ContextKey<T>, value: T): void;
}
