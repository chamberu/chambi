/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * Length of `bytes` without a trailing UTF-8 sequence that the cap cut
 * short. A complete or invalid tail is kept as is.
 */
export function completeLength(bytes: Uint8Array): number {
    // a sequence is at most 4 bytes: look back at most 3 for its lead byte
    for (let back = 1; back <= Math.min(4, bytes.length); back++) {
        const byte = bytes[bytes.length - back] as number;

        if ((byte & 0xC0) === 0x80) {
            continue;
        } // continuation byte

        let expected = 1;

        if ((byte & 0xE0) === 0xC0) {
            expected = 2;
        } else if ((byte & 0xF0) === 0xE0) {
            expected = 3;
        } else if ((byte & 0xF8) === 0xF0) {
            expected = 4;
        }

        return expected > back ? bytes.length - back : bytes.length;
    }

    return bytes.length;
}
