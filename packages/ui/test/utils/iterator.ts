/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * Runs `fn` with the ES2025 iterator helpers removed, as on Safari before 18.4
 * and Firefox before 131 (inside Vite's default build target, never polyfilled).
 */
export function withoutIteratorHelpers<T>(fn: () => T): T {
    const proto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as Record<string, unknown>;
    const names = ['toArray', 'map', 'filter', 'reduce', 'forEach', 'some', 'every', 'find', 'take', 'drop', 'flatMap'];
    const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);

    for (const name of names) {
        delete proto[name];
    }

    try {
        return fn();
    } finally {
        for (const [name, descriptor] of saved) {
            if (descriptor) {
                Object.defineProperty(proto, name, descriptor);
            }
        }
    }
}
