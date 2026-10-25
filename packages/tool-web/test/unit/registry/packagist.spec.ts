/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createRegistryFixture } from '../../utils/registry.ts';
import { json } from '../../utils/web.ts';

const P2 = {
    minified: 'composer/2.0',
    packages: {
        'monolog/monolog': [
            {
                name: 'monolog/monolog',
                description: 'Sends your logs to files, sockets, inboxes, databases and various web services',
                homepage: 'https://github.com/Seldaek/monolog',
                version: '3.6.0-RC1',
                version_normalized: '3.6.0.0-RC1',
                license: ['MIT'],
                source: { url: 'https://github.com/Seldaek/monolog.git', type: 'git' },
                time: '2024-05-01T00:00:00+00:00',
                require: {
                    php: '>=8.1', 
                    'ext-json': '*', 
                    'psr/log': '^2.0 || ^3.0', 
                },
                'require-dev': { phpunit: '^10' },
            },
            {
                version: '3.5.0',
                version_normalized: '3.5.0.0',
                time: '2023-10-27T15:32:31+00:00',
            },
            {
                version: 'v2.0.0',
                version_normalized: '2.0.0.0',
                time: '2019-12-20T14:15:16+00:00',
                require: { php: '>=7.2', 'psr/log': '^1.0.1' },
                homepage: '__unset',
                abandoned: 'monolog/monolog3',
            },
        ],
    },
};

describe('package_info for Packagist', () => {
    it('expands the minified versions and takes the newest stable as latest', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://repo.packagist.org/p2/monolog/monolog.json', json(P2));

        const result = await info({ ecosystem: 'packagist', name: 'Monolog/Monolog' });

        expect(result).toMatchObject({
            name: 'monolog/monolog',
            latest: '3.5.0',
            versions: [
                { version: '3.6.0-RC1', publishedAt: '2024-05-01T00:00:00+00:00' },
                { version: '3.5.0', publishedAt: '2023-10-27T15:32:31+00:00' },
                { version: 'v2.0.0', publishedAt: '2019-12-20T14:15:16+00:00' },
            ],
            version: {
                version: '3.5.0',
                dependencies: [{
                    name: 'psr/log', 
                    requirement: '^2.0 || ^3.0', 
                    kind: 'runtime', 
                }],
                engines: { php: '>=8.1', 'ext-json': '*' },
                deprecated: null,
                license: 'MIT',
            },
            homepage: 'https://github.com/Seldaek/monolog',
            repository: 'https://github.com/Seldaek/monolog',
        });
    });

    it('finds a version with or without its v prefix and reports abandonment', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://repo.packagist.org/p2/monolog/monolog.json', json(P2));

        const result = await info({
            ecosystem: 'packagist', 
            name: 'monolog/monolog', 
            version: '2.0.0', 
        });
        expect(result.version).toMatchObject({
            version: 'v2.0.0',
            deprecated: 'Abandoned, use monolog/monolog3 instead.',
            dependencies: [{
                name: 'psr/log', 
                requirement: '^1.0.1', 
                kind: 'runtime', 
            }],
        });
        expect(result.homepage).toBeNull();
    });
});
