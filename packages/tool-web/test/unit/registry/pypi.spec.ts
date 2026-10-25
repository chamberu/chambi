/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createRegistryFixture, rejection } from '../../utils/registry.ts';
import { json } from '../../utils/web.ts';

const INFO = {
    name: 'requests',
    version: '2.32.0',
    summary: 'HTTP for Humans.',
    home_page: '',
    license: 'Apache-2.0',
    requires_python: '>=3.8',
    requires_dist: [
        'charset-normalizer<4,>=2',
        'idna (<4,>=2.5)',
        "PySocks!=1.5.7,>=1.5.6; extra == 'socks'",
    ],
    project_urls: {
        Documentation: 'https://requests.readthedocs.io',
        Homepage: 'https://requests.readthedocs.io',
        Source: 'https://github.com/psf/requests',
        Changelog: 'https://github.com/psf/requests/blob/main/HISTORY.md',
    },
    yanked: false,
    yanked_reason: null,
};

const PROJECT = {
    info: INFO,
    releases: {
        '2.31.0': [{ upload_time_iso_8601: '2023-05-22T15:12:44.175779Z', yanked: false }],
        '2.32.0': [
            { upload_time_iso_8601: '2024-05-20T15:00:00.000000Z', yanked: true },
            { upload_time_iso_8601: '2024-05-20T14:59:00.000000Z', yanked: true },
        ],
        '0.0.1': [],
    },
};

describe('package_info for PyPI', () => {
    it('reads versions and the latest release', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://pypi.org/pypi/requests/json', json(PROJECT));

        expect(await info({ ecosystem: 'pypi', name: 'requests' })).toEqual({
            ecosystem: 'pypi',
            name: 'requests',
            description: 'HTTP for Humans.',
            latest: '2.32.0',
            tags: {},
            versions: [
                {
                    version: '2.32.0', 
                    publishedAt: '2024-05-20T14:59:00.000000Z', 
                    yanked: true, 
                },
                { version: '2.31.0', publishedAt: '2023-05-22T15:12:44.175779Z' },
                { version: '0.0.1', publishedAt: null },
            ],
            totalVersions: 3,
            version: {
                version: '2.32.0',
                publishedAt: '2024-05-20T14:59:00.000000Z',
                dependencies: [
                    {
                        name: 'charset-normalizer', 
                        requirement: '<4,>=2', 
                        kind: 'runtime', 
                    },
                    {
                        name: 'idna', 
                        requirement: '<4,>=2.5', 
                        kind: 'runtime', 
                    },
                    {
                        name: 'PySocks', 
                        requirement: "!=1.5.7,>=1.5.6; extra == 'socks'", 
                        kind: 'optional', 
                    },
                ],
                engines: { python: '>=3.8' },
                deprecated: null,
                license: 'Apache-2.0',
                yanked: true,
            },
            homepage: 'https://requests.readthedocs.io',
            repository: 'https://github.com/psf/requests',
            changelog: 'https://github.com/psf/requests/blob/main/HISTORY.md',
            source: 'https://pypi.org/pypi/requests/json',
        });
    });

    it('reads an older version from its own document', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://pypi.org/pypi/requests/json', json(PROJECT));
        web.routes.set('https://pypi.org/pypi/requests/2.31.0/json', json({
            info: {
                ...INFO, 
                version: '2.31.0', 
                requires_dist: null, 
                requires_python: '>=3.7', 
                yanked: false,
            },
        }));

        const result = await info({
            ecosystem: 'pypi', 
            name: 'requests', 
            version: '2.31.0', 
        });
        expect(result.latest).toBe('2.32.0');
        expect(result.version).toEqual({
            version: '2.31.0',
            publishedAt: '2023-05-22T15:12:44.175779Z',
            dependencies: [],
            engines: { python: '>=3.7' },
            deprecated: null,
            license: 'Apache-2.0',
        });
    });

    it('names a missing version', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://pypi.org/pypi/requests/json', json(PROJECT));

        const error = await rejection(info({
            ecosystem: 'pypi', 
            name: 'requests', 
            version: '9.0', 
        }));
        expect(error.message).toBe('pypi has no version 9.0 of requests.');
    });
});
