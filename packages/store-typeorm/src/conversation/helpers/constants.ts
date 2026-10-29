/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

// C0, DEL, C1 and lone surrogates (paired surrogates are a code point under /u).
export const FORBIDDEN_FIELD_CHARACTER = /[\p{Cc}\p{Cs}]/u;
export const LONE_SURROGATE = /\p{Cs}/u;
