/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { requestError } from '../request/asserts.ts';
import {
    assertName,
    dependenciesOf,
    licenseOf,
    newestFirst,
    obj,
    repositoryUrl,
    str,
    stringRecord,
    versionDetail,
} from './asserts.ts';
import type { PackageVersion, RegistryAdapter } from './types.ts';

const NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

/** The packument path: a scoped name keeps its `@` and encodes the slash. */
function packagePath(name: string): string {
    return name.startsWith('@') ? `/@${encodeURIComponent(name.slice(1))}` : `/${encodeURIComponent(name)}`;
}

/** npm: the full packument (`application/json`, with times, deprecations and every manifest). */
export const npmRegistry: RegistryAdapter = async (ctx, name, version) => {
    assertName(name, NAME, 'npm package name');
    const path = packagePath(name);
    const doc = obj(await ctx.getJson(path));
    if (Object.keys(doc).length === 0) throw requestError(`npm has no package ${name}.`);

    const tags = stringRecord(doc['dist-tags']);
    const time = stringRecord(doc.time);
    const manifests = obj(doc.versions);
    const versions: PackageVersion[] = Object.entries(manifests).map(([number, value]) => ({
        version: number,
        publishedAt: time[number] ?? null,
        ...(str(obj(value).deprecated) ? { deprecated: true as const } : {}),
    }));

    const target = version === undefined ? tags.latest : (tags[version] ?? version);
    let detail = null;
    let manifest: Record<string, unknown> = {};
    if (target !== undefined) {
        if (!(target in manifests)) throw requestError(`npm has no version ${version ?? target} of ${name}.`);
        manifest = obj(manifests[target]);
        const optional = stringRecord(manifest.optionalDependencies);
        detail = versionDetail({
            version: target,
            publishedAt: time[target] ?? null,
            dependencies: [
                ...dependenciesOf(stringRecord(manifest.dependencies), 'runtime', new Set(Object.keys(optional))),
                ...dependenciesOf(stringRecord(manifest.peerDependencies), 'peer'),
                ...dependenciesOf(optional, 'optional'),
            ],
            engines: stringRecord(manifest.engines),
            deprecated: str(manifest.deprecated),
            license: licenseOf(manifest.license ?? doc.license),
        });
    }

    return {
        name,
        description: str(manifest.description) ?? str(doc.description),
        latest: tags.latest ?? null,
        tags,
        versions: newestFirst(versions),
        version: detail,
        homepage: str(manifest.homepage) ?? str(doc.homepage),
        repository: repositoryUrl(manifest.repository ?? doc.repository),
        changelog: null,
        source: `${ctx.base}${path}`,
    };
};
