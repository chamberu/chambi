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
    stringRecord,
    versionDetail,
} from './asserts.ts';
import type { PackageDependency, PackageVersion, RegistryAdapter } from './types.ts';

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** `name (spec); marker` or `name spec; marker` of requires_dist; an `extra ==` marker makes it optional. */
function requirementOf(line: string): PackageDependency | undefined {
    const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*(?:\[[^\]]*\])?)\s*(.*)$/.exec(line);
    if (!match?.[1]) return undefined;
    const [spec = '', ...markers] = (match[2] ?? '').split(';');
    const range = spec.trim().replace(/^\((.*)\)$/, '$1').trim() || '*';
    const marker = markers.join(';').trim();
    return {
        name: match[1],
        requirement: marker ? `${range}; ${marker}` : range,
        kind: /\bextra\s*==/.test(marker) ? 'optional' : 'runtime',
    };
}

function firstUpload(files: unknown): { publishedAt: string | null; yanked: boolean } {
    const list = Array.isArray(files) ? files.map(obj) : [];
    const times = list.map((file) => str(file.upload_time_iso_8601)).filter((t): t is string => t !== null).sort();
    return {
        publishedAt: times[0] ?? null,
        yanked: list.length > 0 && list.every((file) => file.yanked === true),
    };
}

function urlOf(urls: Record<string, string>, pattern: RegExp): string | null {
    const entry = Object.entries(urls).find(([key]) => pattern.test(key));
    return entry ? entry[1] : null;
}

/** PyPI: the project's JSON (latest info, every release), plus the version's JSON for an older version. */
export const pypiRegistry: RegistryAdapter = async (ctx, name, version) => {
    assertName(name, NAME, 'PyPI project name');
    const path = `/pypi/${encodeURIComponent(name)}/json`;
    const project = obj(await ctx.getJson(path));
    let info = obj(project.info);
    if (Object.keys(info).length === 0) throw requestError(`pypi has no package ${name}.`);
    const latest = str(info.version);

    const releases = obj(project.releases);
    const versions: PackageVersion[] = Object.entries(releases).map(([number, files]) => {
        const upload = firstUpload(files);
        return {
            version: number,
            publishedAt: upload.publishedAt,
            ...(upload.yanked ? { yanked: true as const } : {}),
        };
    });

    const target = version ?? latest;
    if (version !== undefined && version !== latest) {
        info = obj(obj(await ctx.getJson(`/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`)).info);
        if (Object.keys(info).length === 0) throw requestError(`pypi has no version ${version} of ${name}.`);
    }
    const upload = firstUpload(target === null ? [] : releases[target]);
    const urls = stringRecord(info.project_urls);
    const requires = Array.isArray(info.requires_dist) ? info.requires_dist.filter((line): line is string => typeof line === 'string') : [];
    const detail = target === null ? null : versionDetail({
        version: target,
        publishedAt: upload.publishedAt,
        dependencies: requires.map(requirementOf).filter((dep): dep is PackageDependency => dep !== undefined),
        engines: str(info.requires_python) ? { python: info.requires_python as string } : {},
        deprecated: null,
        license: licenseOf(info.license_expression ?? info.license),
        ...(info.yanked === true || upload.yanked ? { yanked: true as const } : {}),
    });

    return {
        name: str(info.name) ?? name,
        description: str(info.summary),
        latest,
        tags: {},
        versions: newestFirst(versions),
        version: detail,
        homepage: str(info.home_page) ?? urlOf(urls, /^home\s*page$/i),
        repository: urlOf(urls, /source|repository|code|github|gitlab/i),
        changelog: urlOf(urls, /change|release|history|news/i),
        source: `${ctx.base}${path}`,
    };
};
