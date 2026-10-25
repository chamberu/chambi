/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { requestError } from '../request/asserts.ts';
import {
    assertName,
    licenseOf,
    newestFirst,
    obj,
    str,
    versionDetail,
} from './asserts.ts';
import type { PackageDependency, PackageVersion, RegistryAdapter } from './types.ts';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function runtimeDependencies(gem: Record<string, unknown>): PackageDependency[] {
    const { runtime } = obj(gem.dependencies);
    return (Array.isArray(runtime) ? runtime : []).map(obj)
        .filter((dep) => str(dep.name) !== null)
        .map((dep) => ({
            name: dep.name as string, 
            requirement: str(dep.requirements) ?? '>= 0', 
            kind: 'runtime' as const, 
        }));
}

/** RubyGems: the gem, its versions (one per number, platforms merged), the version's document for an older one. */
export const rubygemsRegistry: RegistryAdapter = async (ctx, name, version) => {
    assertName(name, NAME, 'gem name', 100);
    const path = `/api/v1/gems/${encodeURIComponent(name)}.json`;
    let gem = obj(await ctx.getJson(path));
    if (Object.keys(gem).length === 0) throw requestError(`rubygems has no package ${name}.`);
    const list = await ctx.getJson(`/api/v1/versions/${encodeURIComponent(name)}.json`);
    const entries = new Map<string, Record<string, unknown>>();
    for (const entry of (Array.isArray(list) ? list : []).map(obj)) {
        const number = str(entry.number);
        if (number && !entries.has(number)) entries.set(number, entry);
    }
    const versions: PackageVersion[] = entries.values().toArray().map((entry) => ({
        version: entry.number as string,
        publishedAt: str(entry.created_at),
    }));
    const latest = str(gem.version);

    const target = version ?? latest;
    if (version !== undefined && version !== latest) {
        gem = obj(await ctx.getJson(`/api/v2/rubygems/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}.json`));
        if (Object.keys(gem).length === 0) throw requestError(`rubygems has no version ${version} of ${name}.`);
    }
    const entry = target === null ? undefined : entries.get(target);
    const ruby = str(entry?.ruby_version) ?? str(gem.required_ruby_version);
    const detail = target === null ? null : versionDetail({
        version: target,
        publishedAt: str(entry?.created_at) ?? str(gem.version_created_at),
        dependencies: runtimeDependencies(gem),
        engines: ruby ? { ruby } : {},
        deprecated: null,
        license: licenseOf(gem.licenses),
    });

    return {
        name: str(gem.name) ?? name,
        description: str(gem.info),
        latest,
        tags: {},
        versions: newestFirst(versions),
        version: detail,
        homepage: str(gem.homepage_uri),
        repository: str(gem.source_code_uri),
        changelog: str(gem.changelog_uri),
        source: `${ctx.base}${path}`,
    };
};
