/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export const copy = <T>(value: T): T => structuredClone(value);

/**
 * Orders strings by Unicode code point, like Postgres `COLLATE "C"` on
 * UTF-8 (`<` compares UTF-16 code units, which puts an astral character
 * such as U+1F600 before U+FFFD).
 */
export function compareCodePoints(a: string, b: string): number {
    const left = a[Symbol.iterator]();
    const right = b[Symbol.iterator]();

    for (;;) {
        const l = left.next();
        const r = right.next();

        if (l.done || r.done) {
            if (l.done && r.done) {
                return 0;
            }

            return l.done ? -1 : 1;
        }

        const diff = l.value.codePointAt(0)! - r.value.codePointAt(0)!;

        if (diff !== 0) {
            return diff;
        }
    }
}
