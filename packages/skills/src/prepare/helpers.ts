/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { dirname, resolve } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { parseSource } from 'skills';
import type { PrepareSkillsOptions } from './types.ts';

// eslint-disable-next-line no-control-regex
const controls = /[\x00-\x1f\x7f]/u;

export function invalid(): never {
    throw new InvalidAgentDefinitionError('Cannot prepare skills: invalid configuration, source, verification or managed directory.');
}

export function copyPreparationOptions(options: PrepareSkillsOptions) {
    if (!options) {
        invalid();
    }

    if (typeof options.source !== 'string' || !options.source.trim() || controls.test(options.source)) {
        invalid();
    }

    if (typeof options.revision !== 'string' || !/^[a-f0-9]{40}$/iu.test(options.revision)) {
        invalid();
    }

    if (!Array.isArray(options.names) || !options.names.length) {
        invalid();
    }

    if (typeof options.directory !== 'string' || !options.directory.trim() || controls.test(options.directory)) {
        invalid();
    }

    if (options.verify !== undefined && typeof options.verify !== 'function') {
        invalid();
    }

    const {
        source,
        verify,
        signal,
    } = options;
    const revision = options.revision.toLowerCase();
    const names = [...options.names];
    for (const name of names) {
        if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(name)) {
            invalid();
        }
    }

    if (new Set(names).size !== names.length) {
        invalid();
    }

    const requestedDirectory = resolve(options.directory);
    if (dirname(requestedDirectory) === requestedDirectory) {
        invalid();
    }

    try {
        const parsed = parseSource(source);
        if (!['local', 'git', 'github', 'gitlab'].includes(parsed.type)) {
            invalid();
        }

        if (parsed.ref || parsed.skillFilter || /^ext::/iu.test(parsed.url)) {
            invalid();
        }

        return {
            source,
            revision,
            names,
            requestedDirectory,
            verify,
            signal,
            parsed,
        };
    } catch {
        return invalid();
    }
}
