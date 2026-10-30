/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { isPackageNotFound } from '../../../src/module/helpers.ts';

function withCode(message: string, code?: string): Error {
    const error = new Error(message);

    if (code) {
        (error as Error & { code: string }).code = code;
    }

    return error;
}

describe('isPackageNotFound', () => {
    it('reads Node\'s missing package', () => {
        const error = withCode('Cannot find package \'@chamvi/sandbox-docker\' imported from /app/x.mjs', 'ERR_MODULE_NOT_FOUND');

        expect(isPackageNotFound(error, '@chamvi/sandbox-docker')).toBe(true);
        expect(isPackageNotFound(error, '@chamvi/sandbox-k8s')).toBe(false);
    });

    it('reads Vite\'s unresolved import', () => {
        const error = withCode('Could not resolve "@chamvi/sandbox-docker" imported by "@chamvi/sandbox".');

        expect(isPackageNotFound(error, '@chamvi/sandbox-docker')).toBe(true);
    });

    it('a missing module inside the package is no missing package', () => {
        const error = withCode(
            'Cannot find module \'/app/node_modules/@chamvi/sandbox-docker/dist/index.mjs\' imported from /app/x.mjs',
            'ERR_MODULE_NOT_FOUND',
        );

        expect(isPackageNotFound(error, '@chamvi/sandbox-docker')).toBe(false);
    });

    it('a package the provider imports is no missing provider', () => {
        const error = withCode(
            'Cannot find package \'dockerode\' imported from /app/node_modules/@chamvi/sandbox-docker/dist/index.mjs',
            'ERR_MODULE_NOT_FOUND',
        );

        expect(isPackageNotFound(error, '@chamvi/sandbox-docker')).toBe(false);
    });

    it('other errors are none', () => {
        expect(isPackageNotFound(new SyntaxError('Unexpected token'), '@chamvi/sandbox-docker')).toBe(false);
        expect(isPackageNotFound('Cannot find package \'@chamvi/sandbox-docker\'', '@chamvi/sandbox-docker')).toBe(false);
        expect(isPackageNotFound(withCode('Could not resolve "@chamvi/sandbox-docker"', 'ERR_OTHER'), '@chamvi/sandbox-docker')).toBe(false);
    });
});
