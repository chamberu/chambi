/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { LICENSE_MAX_CHARS, PACKAGE_DEPENDENCIES_MAX } from './constants.ts';
import type { PackageDependency, PackageVersion, PackageVersionDetail } from './types.ts';

/** A string property, else null; empty strings are null. */
export function str(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** An object, else an empty one. */
export function obj(value: unknown): Record<string, unknown> {
    return isObject(value) ? value : {};
}

/** The string entries of an object. */
export function stringRecord(value: unknown): Record<string, string> {
    return Object.fromEntries(Object.entries(obj(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** `name` checked against `pattern` and the length limit, else a ValidationError (before any request). */
export function assertName(name: string, pattern: RegExp, what: string, max = 214): void {
    if (name.length > max || !pattern.test(name) || name.split('/').some((segment) => segment === '.' || segment === '..')) {
        throw new ValidationError(`${JSON.stringify(name)} is no valid ${what}.`);
    }
}

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_~!-]{0,127}$/;

/** A version (or npm dist-tag) safe to put in a registry path, else a ValidationError. */
export function assertVersion(version: string): void {
    if (!VERSION_PATTERN.test(version)) {
        throw new ValidationError(`${JSON.stringify(version)} is no valid version.`);
    }
}

/** A repository link: `git+https://...git`, `git://`, `github:owner/repo` and `owner/repo` shorthands as https URLs. */
export function repositoryUrl(value: unknown): string | null {
    const raw = typeof value === 'string' ? value : str(obj(value).url);
    if (!raw) return null;
    const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(raw);
    if (shorthand) {
        const hosts: Record<string, string> = { gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };
        return `https://${hosts[shorthand[1] ?? ''] ?? 'github.com'}/${shorthand[2]}`;
    }
    const url = raw
        .replace(/^git\+/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/^ssh:\/\/git@/, 'https://')
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/\.git$/, '');
    return /^https?:\/\//.test(url) ? url : null;
}

/** A license name, cut at LICENSE_MAX_CHARS. */
export function licenseOf(value: unknown): string | null {
    let license: string | null;
    if (Array.isArray(value)) {
        const names = value.filter((item): item is string => typeof item === 'string');
        license = names.length > 0 ? names.join(' OR ') : null;
    } else {
        license = str(value) ?? str(obj(value).type);
    }
    if (!license) return null;
    return license.length > LICENSE_MAX_CHARS ? `${license.slice(0, LICENSE_MAX_CHARS)}...` : license;
}

/** Newest first: by publication time (unknown last), else the given order reversed. */
export function newestFirst(versions: PackageVersion[]): PackageVersion[] {
    return versions
        .map((version, index) => ({ version, index }))
        .sort((a, b) => {
            const at = a.version.publishedAt ? Date.parse(a.version.publishedAt) : -Infinity;
            const bt = b.version.publishedAt ? Date.parse(b.version.publishedAt) : -Infinity;
            if (at !== bt) return bt > at ? 1 : -1;
            return b.index - a.index;
        })
        .map(({ version }) => version);
}

/** The detail with its dependencies cut at PACKAGE_DEPENDENCIES_MAX. */
export function versionDetail(detail: Omit<PackageVersionDetail, 'dependenciesTruncated'>): PackageVersionDetail {
    if (detail.dependencies.length <= PACKAGE_DEPENDENCIES_MAX) return detail;
    return {
        ...detail,
        dependencies: detail.dependencies.slice(0, PACKAGE_DEPENDENCIES_MAX),
        dependenciesTruncated: true,
    };
}

/** `{ name: requirement }` as dependencies of one kind. */
export function dependenciesOf(record: Record<string, string>, kind: PackageDependency['kind'], skip: ReadonlySet<string> = new Set()): PackageDependency[] {
    return Object.entries(record)
        .filter(([name]) => !skip.has(name))
        .map(([name, requirement]) => ({
            name, 
            requirement, 
            kind, 
        }));
}

type Semver = { core: number[]; pre: string[] };

function parseSemver(version: string): Semver | undefined {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
    if (!match) return undefined;
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return b.length - a.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i];
        const y = b[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const nx = /^\d+$/.test(x) ? Number(x) : undefined;
        const ny = /^\d+$/.test(y) ? Number(y) : undefined;
        if (nx !== undefined && ny !== undefined) {
            if (nx !== ny) return nx - ny;
        } else if (nx !== undefined) {
            return -1;
        } else if (ny !== undefined) {
            return 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}

/** Semver order (a `v` prefix allowed); versions that are no semver sort below the others, by text. */
export function compareSemver(a: string, b: string): number {
    const x = parseSemver(a);
    const y = parseSemver(b);
    if (!x || !y) {
        if (x) return 1;
        if (y) return -1;
        if (a === b) return 0;
        return a < b ? -1 : 1;
    }
    for (let i = 0; i < 3; i++) {
        if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
    }
    return comparePre(x.pre, y.pre);
}
