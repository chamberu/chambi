/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { PackageEcosystem } from './types.ts';

/** The registries `package_info` asks unless `registries` names others. */
export const DEFAULT_REGISTRIES: Readonly<Record<PackageEcosystem, string>> = Object.freeze({
    npm: 'https://registry.npmjs.org',
    pypi: 'https://pypi.org',
    crates: 'https://crates.io',
    packagist: 'https://repo.packagist.org',
    go: 'https://proxy.golang.org',
    rubygems: 'https://rubygems.org',
});

/** Versions `package_info` lists at most (newest first). */
export const PACKAGE_VERSIONS_MAX = 100;

/** Dependencies of one version `package_info` lists at most. */
export const PACKAGE_DEPENDENCIES_MAX = 200;

/** Bytes of one registry answer read at most (32 MiB: some npm documents are large). */
export const REGISTRY_MAX_BYTES = 33_554_432;

/** Characters of a license text kept (PyPI's `license` may hold the whole text). */
export const LICENSE_MAX_CHARS = 200;
