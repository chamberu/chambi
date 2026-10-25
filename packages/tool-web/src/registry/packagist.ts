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
    obj,
    repositoryUrl,
    str,
    stringRecord,
    versionDetail,
} from './asserts.ts';
import type { PackageVersion, RegistryAdapter } from './types.ts';

const NAME = /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/;

/** Composer's minified p2 list expanded: each entry inherits the previous one's keys, `__unset` removes one. */
function expand(list: unknown[]): Array<Record<string, unknown>> {
    let previous: Record<string, unknown> = {};
    return list.map((item) => {
        const expanded: Record<string, unknown> = { ...previous };
        for (const [key, value] of Object.entries(obj(item))) {
            if (value === '__unset') delete expanded[key];
            else expanded[key] = value;
        }
        previous = expanded;
        return expanded;
    });
}

/** Platform requirements (`php`, `ext-*`, `lib-*`, `composer-*`) count as engines. */
function isPlatform(name: string): boolean {
    return name === 'php' || name === 'hhvm' || /^(?:ext|lib|composer|php)-/.test(name);
}

function deprecationOf(abandoned: unknown): string | null {
    if (typeof abandoned === 'string' && abandoned.length > 0) return `Abandoned, use ${abandoned} instead.`;
    return abandoned === true ? 'Abandoned.' : null;
}

/** Packagist: the p2 metadata of tagged releases, newest first. */
export const packagistRegistry: RegistryAdapter = async (ctx, input, version) => {
    const name = input.toLowerCase();
    assertName(name, NAME, 'Packagist package name (vendor/name)');
    const [vendor = '', project = ''] = name.split('/');
    const path = `/p2/${encodeURIComponent(vendor)}/${encodeURIComponent(project)}.json`;
    const list = obj(obj(await ctx.getJson(path)).packages)[name];
    if (!Array.isArray(list)) throw requestError(`packagist has no package ${name}.`);
    const entries = expand(list).filter((entry) => str(entry.version) !== null);

    const versions: PackageVersion[] = entries.map((entry) => ({ version: entry.version as string, publishedAt: str(entry.time) }));
    const stable = entries.find((entry) => !String(entry.version_normalized ?? entry.version).includes('-')) ?? entries[0];
    const latest = stable ? stable.version as string : null;

    const wanted = version?.replace(/^v/, '');
    const entry = wanted === undefined ? stable : entries.find((item) => String(item.version).replace(/^v/, '') === wanted);
    if (version !== undefined && !entry) throw requestError(`packagist has no version ${version} of ${name}.`);
    const current = entry ?? {};
    const require = stringRecord(current.require);
    const detail = entry ? versionDetail({
        version: entry.version as string,
        publishedAt: str(entry.time),
        dependencies: dependenciesOf(Object.fromEntries(Object.entries(require).filter(([key]) => !isPlatform(key))), 'runtime'),
        engines: Object.fromEntries(Object.entries(require).filter(([key]) => isPlatform(key))),
        deprecated: deprecationOf(entry.abandoned),
        license: licenseOf(entry.license),
    }) : null;

    return {
        name,
        description: str(current.description),
        latest,
        tags: {},
        versions,
        version: detail,
        homepage: str(current.homepage),
        repository: repositoryUrl(obj(current.source).url),
        changelog: null,
        source: `${ctx.base}${path}`,
    };
};
