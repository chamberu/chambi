/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError, ValidationError } from '@chamvi/core';

/** `argv` is a non-empty list of strings without NUL, the first one non-empty. */
export function assertArgv(argv: readonly string[]): void {
    const hasInvalidArgument = Array.isArray(argv) &&
        argv.length !== 0 &&
        argv[0] !== '' &&
        argv.some((arg) => !(typeof arg === 'string' && !arg.includes('\0')));

    if (
        !Array.isArray(argv) ||
        argv.length === 0 ||
        argv[0] === '' ||
        hasInvalidArgument
    ) {
        throw new ValidationError('argv must be a non-empty list of strings without NUL, starting with the command.');
    }
}

/**
 * Decodes a file's bytes as UTF-8. A file that is not valid UTF-8 (Latin-1,
 * binary) is a `SandboxError`: decoding it lossily would let `edit_file`
 * write U+FFFD over every invalid byte, not only the edited span.
 */
export function decodeUtf8File(bytes: Uint8Array, file: string): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        throw new SandboxError(`${file} is not UTF-8 text.`, { cause: error });
    }
}
