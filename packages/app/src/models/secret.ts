/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { envString } from '../env/module.ts';
import type { Env } from '../env/types.ts';
import type { SecretValue } from './types.ts';

function fail(message: string): never {
    throw new InvalidAgentDefinitionError(message);
}

function trimNewline(value: string): string {
    if (value.endsWith('\r\n')) {
        return value.slice(0, -2);
    }

    return value.endsWith('\n') ? value.slice(0, -1) : value;
}

/**
 * The secret a SecretValue names: a literal as is, `{ env }` from the given env
 * only, `{ file }` relative to `cwd` with one trailing newline trimmed. Every
 * error names the field (and the variable or path), never a value.
 */
export async function readSecret(
    value: SecretValue,
    input: {
        /** The app's env; `{ env }` never falls back to process.env. */
        env: Env;
        /** The base of a relative `{ file }`. */
        cwd: string;
        /** Named in every error (a variable or a config file field), never the value. */
        field: string;
    },
): Promise<string> {
    // Config file values arrive unchecked, so the shape is checked here too.
    const raw: unknown = value;
    let secret: string;
    if (typeof raw === 'string') {
        secret = raw;
    } else if (isObject(raw) && typeof raw.env === 'string') {
        const name = raw.env;
        secret = envString(input.env, name) ?? fail(`${input.field}: the variable ${name} is not set.`);
    } else if (isObject(raw) && typeof raw.file === 'string') {
        const path = resolve(input.cwd, raw.file);
        let content: string;
        try {
            content = await readFile(path, 'utf8');
        } catch {
            fail(`${input.field}: the file ${path} cannot be read.`);
        }
        secret = trimNewline(content);
    } else {
        fail(`${input.field} must be a string, { env: string } or { file: string }.`);
    }

    if (secret.length === 0) {
        fail(`${input.field} is empty.`);
    }

    return secret;
}
