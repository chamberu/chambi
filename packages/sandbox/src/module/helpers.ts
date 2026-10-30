/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { envList } from '@chamvi/app';
import type { Env } from '@chamvi/app';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { assertImage } from '../image/module.ts';

/**
 * The image allow-list of `CHAMVI_SANDBOX_IMAGES` (a comma list, exact
 * references), or undefined when the variable is unset or holds no entry
 * (only separators and blanks), so no image parameter is offered. An entry that is no
 * image reference is an InvalidAgentDefinitionError naming the variable,
 * never the entry.
 */
export function readImageAllowList(env: Env): ((image: string) => boolean) | undefined {
    const entries = envList(env, 'CHAMVI_SANDBOX_IMAGES');

    if (entries === undefined) {
        return undefined;
    }

    const images = new Set<string>();

    for (const entry of entries.map((value) => value.trim()).filter(Boolean)) {
        try {
            images.add(assertImage(entry));
        } catch {
            throw new InvalidAgentDefinitionError('CHAMVI_SANDBOX_IMAGES holds an entry that is no image reference.');
        }
    }

    if (images.size === 0) {
        return undefined;
    }

    return (image) => images.has(image);
}

/**
 * True when the package itself is not installed, not when something it
 * imports is missing: Node's ERR_MODULE_NOT_FOUND "Cannot find package
 * '<specifier>'", or Vite's (the Vitest module runner's) code-less
 * "Could not resolve "<specifier>"".
 */
export function isPackageNotFound(error: unknown, specifier: string): boolean {
    if (!isObject(error) || typeof error.message !== 'string') {
        return false;
    }

    if (error.code === 'ERR_MODULE_NOT_FOUND') {
        return error.message.startsWith(`Cannot find package '${specifier}'`);
    }

    return error.code === undefined && error.message.startsWith(`Could not resolve "${specifier}"`);
}

/** Imports a package by a variable specifier, so the bundler and tsc leave it alone. */
export function loadPackage<T>(specifier: string): Promise<T> {
    return import(specifier) as Promise<T>;
}
