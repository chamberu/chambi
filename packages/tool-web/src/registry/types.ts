/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The package registries `package_info` reads. */
export type PackageEcosystem = 'npm' | 'pypi' | 'crates' | 'packagist' | 'go' | 'rubygems';

/** One published version; newest first in PackageInfo.versions. */
export type PackageVersion = {
    version: string;
    /** ISO time of the publication, when the registry tells it. */
    publishedAt: string | null;
    /** Withdrawn by its publisher (PyPI, crates.io). */
    yanked?: true;
    /** Marked deprecated (npm). */
    deprecated?: true;
};

/** A dependency of a version: `requirement` as the registry writes it (a range, a version, markers). */
export type PackageDependency = {
    name: string;
    requirement: string;
    kind: 'runtime' | 'peer' | 'optional' | 'build';
};

/** The detail of one version (the asked one, else the latest). */
export type PackageVersionDetail = {
    version: string;
    publishedAt: string | null;
    /** Runtime, peer, optional and build dependencies (development ones left out), at most PACKAGE_DEPENDENCIES_MAX. */
    dependencies: PackageDependency[];
    /** True when dependencies were cut at PACKAGE_DEPENDENCIES_MAX. */
    dependenciesTruncated?: true;
    /** Runtime requirements: npm `engines`, `python` (requires-python), `rust`, `go`/`toolchain`, `php` and its extensions, `ruby`. */
    engines: Record<string, string>;
    /** The deprecation (npm) or abandonment (Packagist) notice, or a Go module's `Deprecated:` comment. */
    deprecated: string | null;
    license: string | null;
    yanked?: true;
};

/** `package_info`. */
export type PackageInfo = {
    ecosystem: PackageEcosystem;
    name: string;
    description: string | null;
    /** The latest stable version as the registry names it. */
    latest: string | null;
    /** npm dist-tags; empty elsewhere. */
    tags: Record<string, string>;
    /** Newest first, at most PACKAGE_VERSIONS_MAX. */
    versions: PackageVersion[];
    totalVersions: number;
    version: PackageVersionDetail | null;
    homepage: string | null;
    repository: string | null;
    /** A changelog or release notes link the registry carries (PyPI, RubyGems). */
    changelog: string | null;
    /** The registry document this was read from. */
    source: string;
};

/** What an adapter gets: GETs against its registry base, a 404 (or 410) read as undefined. */
export type RegistryContext = {
    ecosystem: PackageEcosystem;
    base: string;
    getJson(path: string): Promise<unknown>;
    getText(path: string): Promise<string | undefined>;
};

/** What an adapter returns before the caps. */
export type RegistryAnswer = Omit<PackageInfo, 'ecosystem' | 'totalVersions'>;

export type RegistryAdapter = (ctx: RegistryContext, name: string, version?: string) => Promise<RegistryAnswer>;
