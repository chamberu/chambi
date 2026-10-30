/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type JsonToken = { text: string; kind?: 'k' | 's' | 'c' };

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b/g;

/** Splits pretty JSON into key, string and literal runs for highlighting (rendered as text, never HTML). */
export function tokenizeJson(json: string): JsonToken[] {
    const tokens: JsonToken[] = [];
    let last = 0;

    for (const match of json.matchAll(TOKEN)) {
        const { index } = match;

        if (index > last) {
            tokens.push({ text: json.slice(last, index) });
        }

        if (match[1] !== undefined) {
            tokens.push({ text: match[1], kind: match[2] !== undefined ? 'k' : 's' });

            if (match[2] !== undefined) {
                tokens.push({ text: match[2] });
            }
        } else {
            tokens.push({ text: match[0], kind: 'c' });
        }

        last = index + match[0].length;
    }

    if (last < json.length) {
        tokens.push({ text: json.slice(last) });
    }

    return tokens;
}
