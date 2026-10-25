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

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function dependencyOf(entry: Record<string, unknown>): PackageDependency | undefined {
    const name = str(entry.crate_id);
    if (!name || entry.kind === 'dev') return undefined;
    let kind: PackageDependency['kind'] = 'runtime';
    if (entry.kind === 'build') kind = 'build';
    else if (entry.optional === true) kind = 'optional';
    return {
        name, 
        requirement: str(entry.req) ?? '*', 
        kind, 
    };
}

/** crates.io: the crate (with its versions), the version's dependencies. */
export const cratesRegistry: RegistryAdapter = async (ctx, name, version) => {
    assertName(name, NAME, 'crate name');
    const path = `/api/v1/crates/${encodeURIComponent(name)}`;
    const doc = obj(await ctx.getJson(path));
    const crate = obj(doc.crate);
    if (Object.keys(crate).length === 0) throw requestError(`crates has no package ${name}.`);
    const list = Array.isArray(doc.versions) ?
        doc.versions :
        obj(await ctx.getJson(`${path}/versions`)).versions;
    const entries = (Array.isArray(list) ? list : []).map(obj).filter((entry) => str(entry.num) !== null);

    const versions: PackageVersion[] = entries.map((entry) => ({
        version: entry.num as string,
        publishedAt: str(entry.created_at),
        ...(entry.yanked === true ? { yanked: true as const } : {}),
    }));
    const latest = str(crate.max_stable_version) ?? str(crate.max_version) ?? str(crate.newest_version);

    const target = version ?? latest;
    let detail = null;
    if (target !== null) {
        const entry = entries.find((item) => item.num === target);
        if (!entry) throw requestError(`crates has no version ${target} of ${name}.`);
        const deps = obj(await ctx.getJson(`${path}/${encodeURIComponent(target)}/dependencies`)).dependencies;
        detail = versionDetail({
            version: target,
            publishedAt: str(entry.created_at),
            dependencies: (Array.isArray(deps) ? deps : []).map(obj).map(dependencyOf)
                .filter((dep): dep is PackageDependency => dep !== undefined),
            engines: str(entry.rust_version) ? { rust: entry.rust_version as string } : {},
            deprecated: null,
            license: licenseOf(entry.license),
            ...(entry.yanked === true ? { yanked: true as const } : {}),
        });
    }

    return {
        name,
        description: str(crate.description),
        latest,
        tags: {},
        versions: newestFirst(versions),
        version: detail,
        homepage: str(crate.homepage) ?? str(crate.documentation),
        repository: str(crate.repository),
        changelog: null,
        source: `${ctx.base}${path}`,
    };
};
