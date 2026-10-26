/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { Env } from '@chamvi/app';
import { isRecord } from '../run/helpers.ts';
import { CLI_PACKAGE_NAME } from './constants.ts';

/**
 * The CLI's version: the nearest package.json named @chamvi/cli above this
 * file (src/commands in the sources, dist in the build).
 */
export function readVersion(from: string = fileURLToPath(import.meta.url)): string | undefined {
    let dir = path.dirname(from);
    for (;;) {
        try {
            const manifest: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
            if (isRecord(manifest) && manifest.name === CLI_PACKAGE_NAME && typeof manifest.version === 'string') {
                return manifest.version;
            }
        } catch {
            // no (readable) package.json here
        }

        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/**
 * Copies the keys of `<cwd>/.env` that `env` lacks (unset or empty) into
 * `env`, in place, so module factories reading `process.env` at the entry
 * import see them; never overrides a set variable. A missing file is fine.
 */
export async function loadDotEnv(env: Env, file: string): Promise<void> {
    let text: string;
    try {
        text = await readFile(file, 'utf8');
    } catch {
        return;
    }

    for (const [key, value] of Object.entries(parseEnv(text))) {
        const current = env[key];
        if (typeof current !== 'string' || current.length === 0) {
            env[key] = value;
        }
    }
}
