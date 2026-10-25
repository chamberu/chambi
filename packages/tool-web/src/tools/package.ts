/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool } from 'ai';
import { defineTool } from '@chamvi/core';
import { PACKAGE_ECOSYSTEMS, packageInfo } from '../registry/module.ts';
import { PACKAGE_VERSIONS_MAX } from '../registry/constants.ts';
import type { PackageEcosystem, PackageInfo } from '../registry/types.ts';
import { UNTRUSTED_NOTE } from './constants.ts';
import {
    inputObject,
    objectSchema,
    optionalString,
    requireOneOf,
    requireString,
    signalOf,
} from './asserts.ts';
import type { ResolvedWebOptions } from './asserts.ts';

type PackageInfoInput = {
    ecosystem: PackageEcosystem;
    name: string;
    version?: string;
};

export function packageInfoTool(options: ResolvedWebOptions): Tool<PackageInfoInput, PackageInfo> {
    return defineTool<PackageInfoInput, PackageInfo>({
        description: 'Look up a package in its registry (npm, pypi, crates, packagist, go, rubygems): description, latest version, ' +
            `npm dist-tags, up to ${PACKAGE_VERSIONS_MAX} versions with dates (newest first), and for one version (default the latest) ` +
            'its dependencies, engines (node, python, rust, go, php, ruby), deprecation, license, repository and changelog links. ' +
            `For release notes between two versions read the repository (github_list_releases, web_fetch). ${UNTRUSTED_NOTE}`,
        inputSchema: objectSchema<PackageInfoInput>({
            ecosystem: {
                type: 'string',
                enum: [...PACKAGE_ECOSYSTEMS],
                description: 'The registry: npm, pypi, crates (crates.io), packagist (Composer), go (module proxy) or rubygems.',
            },
            name: {
                type: 'string',
                minLength: 1,
                description: 'The package name, e.g. "@types/node", "requests", "serde", "monolog/monolog", "github.com/pkg/errors", "rails".',
            },
            version: {
                type: 'string',
                minLength: 1,
                description: 'A version (or an npm dist-tag) to detail. Default: the latest.',
            },
        }, ['ecosystem', 'name']),
        execute: async (input, { abortSignal, context }) => {
            const body = inputObject(input);
            return packageInfo(options.request, options.registries, {
                ecosystem: requireOneOf(body.ecosystem, 'ecosystem', PACKAGE_ECOSYSTEMS),
                name: requireString(body.name, 'name'),
                version: optionalString(body.version, 'version'),
                signal: signalOf(abortSignal, context),
            });
        },
    });
}
