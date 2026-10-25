/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { requestError } from '../request/asserts.ts';
import type { Requester } from '../request/types.ts';
import { assertVersion } from './asserts.ts';
import { PACKAGE_VERSIONS_MAX, REGISTRY_MAX_BYTES } from './constants.ts';
import { cratesRegistry } from './crates.ts';
import { goRegistry } from './go.ts';
import { npmRegistry } from './npm.ts';
import { packagistRegistry } from './packagist.ts';
import { pypiRegistry } from './pypi.ts';
import { rubygemsRegistry } from './rubygems.ts';
import type {
    PackageEcosystem,
    PackageInfo,
    RegistryAdapter,
    RegistryContext,
} from './types.ts';

const ADAPTERS: Record<PackageEcosystem, RegistryAdapter> = {
    npm: npmRegistry,
    pypi: pypiRegistry,
    crates: cratesRegistry,
    packagist: packagistRegistry,
    go: goRegistry,
    rubygems: rubygemsRegistry,
};

/** Every ecosystem `package_info` knows. */
export const PACKAGE_ECOSYSTEMS = Object.keys(ADAPTERS) as PackageEcosystem[];

export type PackageQuery = {
    ecosystem: PackageEcosystem;
    name: string;
    version?: string;
    signal: AbortSignal;
};

/** GETs against one registry: its origin trusted, 404 and 410 read as undefined, bodies up to REGISTRY_MAX_BYTES. */
function registryContext(request: Requester, ecosystem: PackageEcosystem, base: string, signal: AbortSignal): RegistryContext {
    const trusted = [new URL(base).origin];
    const get = async (path: string, accept: string): Promise<string | undefined> => {
        const url = `${base}${path}`;
        const response = await request(url, {
            signal,
            accept,
            trusted,
            acceptStatus: [404, 410],
            maxBytes: REGISTRY_MAX_BYTES,
        });
        if (response.status === 404 || response.status === 410) return undefined;
        if (response.truncated) {
            throw requestError(`The ${ecosystem} registry answer at ${url} is larger than ${REGISTRY_MAX_BYTES} bytes.`);
        }
        return new TextDecoder().decode(response.bytes);
    };
    return {
        ecosystem,
        base,
        getText: (path) => get(path, 'text/plain, */*'),
        getJson: async (path) => {
            const text = await get(path, 'application/json');
            if (text === undefined) return undefined;
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw requestError(`The ${ecosystem} registry answered ${base}${path} with something that is not JSON.`);
            }
        },
    };
}

/** The registry metadata of a package, versions capped at PACKAGE_VERSIONS_MAX. */
export async function packageInfo(
    request: Requester,
    registries: Record<PackageEcosystem, string>,
    query: PackageQuery,
): Promise<PackageInfo> {
    if (query.version !== undefined) assertVersion(query.version);
    const ctx = registryContext(request, query.ecosystem, registries[query.ecosystem], query.signal);
    const answer = await ADAPTERS[query.ecosystem](ctx, query.name, query.version);
    return {
        ...answer,
        ecosystem: query.ecosystem,
        versions: answer.versions.slice(0, PACKAGE_VERSIONS_MAX),
        totalVersions: answer.versions.length,
    };
}
