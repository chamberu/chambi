/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * A \u escape that Postgres jsonb rejects: NUL, or a surrogate. JSON.stringify
 * writes surrogate pairs as raw characters, so an escaped surrogate is always
 * a lone one. The leading group keeps an escaped backslash (`\\u0000` is the
 * text "\u0000", not a NUL) out of the match.
 */
const UNSUPPORTED_JSONB_ESCAPE = /(?<!\\)((?:\\\\)*)\\u(?:0000|d[89a-f][0-9a-f]{2})/g;

/**
 * The value the Postgres driver serializes for a jsonb column: NUL
 * characters and lone surrogates, which jsonb cannot hold, become U+FFFD.
 * The driver writes JSON.stringify(value) for anything but null and
 * undefined (which become SQL NULL), so a JSON null and the sanitized value
 * both travel through toJSON. The value is only re-parsed when sanitizing
 * changed it.
 */
export function toJsonParameter(value: unknown): { toJSON: () => unknown } {
    const text = JSON.stringify(value);
    const clean = text.replace(UNSUPPORTED_JSONB_ESCAPE, '$1\\ufffd');
    return { toJSON: () => (clean === text ? value : JSON.parse(clean)) };
}
